-- Merges duplicate ProviderConnection rows for the same provider into the
-- oldest one. This happened in practice because the very first request to
-- a freshly-deployed (empty) production database auto-created a new
-- Google Cloud connection via ensureGoogleConnection(), and a separate
-- data copy from local dev then added a second, older connection row on
-- top — from that point on, every discovery sync kept finding "real"
-- projects under the copied-in connection's resources (mapped, budgeted)
-- while re-discovering the *same* projects as fresh, unmapped rows under
-- the auto-created one, because the previous migration's dedup logic is
-- correctly scoped per-connection and had no way to know the two
-- connections were accidentally the same thing. Idempotent: a no-op
-- wherever there's only one connection per provider, which is the normal
-- case and stays true going forward — ensureGoogleConnection() itself was
-- never the bug, this migration only cleans up the one historical
-- accident.

CREATE TEMP TABLE connection_dedup AS
SELECT
  id,
  provider,
  "createdAt",
  ROW_NUMBER() OVER (PARTITION BY provider ORDER BY "createdAt" ASC, id) AS rn
FROM "provider_connections";

CREATE TEMP TABLE connection_merge_map AS
SELECT l.id AS loser_id, w.id AS winner_id
FROM connection_dedup l
JOIN connection_dedup w ON w.provider = l.provider AND w.rn = 1
WHERE l.rn > 1;

-- Accounts: where the winner connection already has an account with the
-- same externalAccountId, repoint that account's resources to the
-- winner's account before dropping the loser account; otherwise just move
-- the account itself over (no matching account to merge into).
UPDATE "provider_resources" pr
SET "providerAccountId" = wa.id
FROM "provider_accounts" la
JOIN connection_merge_map mm ON mm.loser_id = la."providerConnectionId"
JOIN "provider_accounts" wa
  ON wa."providerConnectionId" = mm.winner_id
 AND wa."externalAccountId" = la."externalAccountId"
WHERE pr."providerAccountId" = la.id;

DELETE FROM "provider_accounts" la
USING connection_merge_map mm, "provider_accounts" wa
WHERE la."providerConnectionId" = mm.loser_id
  AND wa."providerConnectionId" = mm.winner_id
  AND wa."externalAccountId" = la."externalAccountId";

UPDATE "provider_accounts" la
SET "providerConnectionId" = mm.winner_id
FROM connection_merge_map mm
WHERE la."providerConnectionId" = mm.loser_id;

-- A loser resource can collide with one that already exists under the
-- winner connection (same project discovered independently by both) —
-- moving it with a plain UPDATE would hit the unique constraint mid-move,
-- since Postgres checks it per-row, not deferred. Merge those collisions
-- directly into the pre-existing winner-connection resource first.
CREATE TEMP TABLE precollision_map AS
SELECT lr.id AS loser_id, wr.id AS winner_id
FROM "provider_resources" lr
JOIN connection_merge_map mm ON mm.loser_id = lr."providerConnectionId"
JOIN "provider_resources" wr
  ON wr."providerConnectionId" = mm.winner_id
 AND wr."resourceType" = lr."resourceType"
 AND wr."externalResourceId" = lr."externalResourceId";

UPDATE "cost_records" cr
SET "providerResourceId" = mm.winner_id
FROM precollision_map mm
WHERE cr."providerResourceId" = mm.loser_id
  AND NOT EXISTS (
    SELECT 1 FROM "cost_records" cr2
    WHERE cr2."providerResourceId" = mm.winner_id
      AND cr2."usageDate" = cr."usageDate"
      AND cr2.service = cr.service
      AND cr2.sku = cr.sku
      AND cr2.currency = cr.currency
  );

DELETE FROM "cost_records" cr
USING precollision_map mm
WHERE cr."providerResourceId" = mm.loser_id;

UPDATE "app_resource_mappings" m
SET "providerResourceId" = mm.winner_id
FROM precollision_map mm
WHERE m."providerResourceId" = mm.loser_id
  AND NOT EXISTS (
    SELECT 1 FROM "app_resource_mappings" m2
    WHERE m2."providerResourceId" = mm.winner_id
      AND m2."managedAppId" = m."managedAppId"
  );

DELETE FROM "app_resource_mappings" m
USING precollision_map mm
WHERE m."providerResourceId" = mm.loser_id;

UPDATE "budgets" b
SET "scopeId" = mm.winner_id
FROM precollision_map mm
WHERE b."scopeType" = 'PROVIDER_RESOURCE' AND b."scopeId" = mm.loser_id;

DELETE FROM "provider_resources" pr
USING precollision_map mm
WHERE pr.id = mm.loser_id;

DROP TABLE precollision_map;

-- Everything left in a loser connection has no counterpart under the
-- winner, so this move is now collision-free. Then re-run the same
-- identity-merge as the previous migration as a safety net, in case a
-- single loser connection itself already held duplicates of its own.
UPDATE "provider_resources" pr
SET "providerConnectionId" = mm.winner_id
FROM connection_merge_map mm
WHERE pr."providerConnectionId" = mm.loser_id;

CREATE TEMP TABLE resource_dedup2 AS
SELECT
  pr.id,
  pr."providerConnectionId",
  pr."resourceType",
  pr."externalResourceId",
  ROW_NUMBER() OVER (
    PARTITION BY pr."providerConnectionId", pr."resourceType", pr."externalResourceId"
    ORDER BY
      (SELECT COUNT(*) FROM "app_resource_mappings" m WHERE m."providerResourceId" = pr.id) DESC,
      (SELECT COUNT(*) FROM "cost_records" cr WHERE cr."providerResourceId" = pr.id) DESC,
      pr."lastSeenAt" DESC,
      pr.id
  ) AS rn
FROM "provider_resources" pr;

CREATE TEMP TABLE resource_merge_map2 AS
SELECT r.id AS loser_id, w.id AS winner_id
FROM resource_dedup2 r
JOIN resource_dedup2 w
  ON w."providerConnectionId" = r."providerConnectionId"
 AND w."resourceType" = r."resourceType"
 AND w."externalResourceId" = r."externalResourceId"
 AND w.rn = 1
WHERE r.rn > 1;

UPDATE "cost_records" cr
SET "providerResourceId" = mm.winner_id
FROM resource_merge_map2 mm
WHERE cr."providerResourceId" = mm.loser_id
  AND NOT EXISTS (
    SELECT 1 FROM "cost_records" cr2
    WHERE cr2."providerResourceId" = mm.winner_id
      AND cr2."usageDate" = cr."usageDate"
      AND cr2.service = cr.service
      AND cr2.sku = cr.sku
      AND cr2.currency = cr.currency
  );

DELETE FROM "cost_records" cr
USING resource_merge_map2 mm
WHERE cr."providerResourceId" = mm.loser_id;

UPDATE "app_resource_mappings" m
SET "providerResourceId" = mm.winner_id
FROM resource_merge_map2 mm
WHERE m."providerResourceId" = mm.loser_id
  AND NOT EXISTS (
    SELECT 1 FROM "app_resource_mappings" m2
    WHERE m2."providerResourceId" = mm.winner_id
      AND m2."managedAppId" = m."managedAppId"
  );

DELETE FROM "app_resource_mappings" m
USING resource_merge_map2 mm
WHERE m."providerResourceId" = mm.loser_id;

UPDATE "budgets" b
SET "scopeId" = mm.winner_id
FROM resource_merge_map2 mm
WHERE b."scopeType" = 'PROVIDER_RESOURCE' AND b."scopeId" = mm.loser_id;

DELETE FROM "provider_resources" pr
USING resource_merge_map2 mm
WHERE pr.id = mm.loser_id;

-- Preserve sync history instead of losing it to the connection's cascade
-- delete below.
UPDATE "sync_jobs" sj
SET "providerConnectionId" = mm.winner_id
FROM connection_merge_map mm
WHERE sj."providerConnectionId" = mm.loser_id;

DELETE FROM "provider_connections" pc
USING connection_merge_map mm
WHERE pc.id = mm.loser_id;

DROP TABLE connection_dedup;
DROP TABLE connection_merge_map;
DROP TABLE resource_dedup2;
DROP TABLE resource_merge_map2;
