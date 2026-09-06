-- Fixes the ProviderResource identity bug: uniqueness was keyed on
-- (providerAccountId, externalResourceId), so a project whose billing
-- account changed between discovery syncs (billing disabled/re-enabled,
-- moved accounts) got a brand-new orphan row instead of an update to the
-- existing one — the same real GCP project ended up duplicated, some
-- copies mapped to a site, some not, inflating "unmapped projects" and
-- risking split cost history. This migration re-keys identity on
-- (providerConnectionId, resourceType, externalResourceId) instead — a
-- GCP project id is stable regardless of which billing account currently
-- owns it — and merges any duplicates that already exist before the new
-- constraint is added (a duplicate unique key would otherwise fail to
-- create).

-- 1. Add the new identity column, backfilled from the resource's current
--    billing account's connection (nullable for now — becomes NOT NULL
--    once every row is backfilled, a few steps down).
ALTER TABLE "provider_resources" ADD COLUMN "providerConnectionId" TEXT;

UPDATE "provider_resources" pr
SET "providerConnectionId" = pa."providerConnectionId"
FROM "provider_accounts" pa
WHERE pa.id = pr."providerAccountId";

-- 2. Merge duplicates. For each (providerConnectionId, resourceType,
--    externalResourceId) group, keep exactly one row — preferring, in
--    order: the one with an app mapping (real user-visible state), then
--    the one with the most cost history, then the most recently seen.
--    Everything referencing a "loser" row is re-pointed to the winner
--    before the loser is deleted, so no mapping/cost/budget is lost.
CREATE TEMP TABLE resource_dedup AS
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

CREATE TEMP TABLE resource_merge_map AS
SELECT r.id AS loser_id, w.id AS winner_id
FROM resource_dedup r
JOIN resource_dedup w
  ON w."providerConnectionId" = r."providerConnectionId"
 AND w."resourceType" = r."resourceType"
 AND w."externalResourceId" = r."externalResourceId"
 AND w.rn = 1
WHERE r.rn > 1;

-- Cost records: move a loser's rows to the winner unless the winner
-- already has a row for that exact natural key (both discovered the same
-- real usage independently) — those true duplicates are just dropped.
UPDATE "cost_records" cr
SET "providerResourceId" = mm.winner_id
FROM resource_merge_map mm
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
USING resource_merge_map mm
WHERE cr."providerResourceId" = mm.loser_id;

-- App resource mappings: same pattern, unique key is (managedAppId, providerResourceId).
UPDATE "app_resource_mappings" m
SET "providerResourceId" = mm.winner_id
FROM resource_merge_map mm
WHERE m."providerResourceId" = mm.loser_id
  AND NOT EXISTS (
    SELECT 1 FROM "app_resource_mappings" m2
    WHERE m2."providerResourceId" = mm.winner_id
      AND m2."managedAppId" = m."managedAppId"
  );

DELETE FROM "app_resource_mappings" m
USING resource_merge_map mm
WHERE m."providerResourceId" = mm.loser_id;

-- Budgets scoped to a provider resource: scopeId is a loose string
-- (no FK), re-point it directly — a duplicate budget scoped to the same
-- winner is left alone (budgets have no natural-key constraint to collide
-- with; a genuine duplicate here predates this migration and is a
-- separate, visible cleanup, not silently droppable data).
UPDATE "budgets" b
SET "scopeId" = mm.winner_id
FROM resource_merge_map mm
WHERE b."scopeType" = 'PROVIDER_RESOURCE' AND b."scopeId" = mm.loser_id;

DELETE FROM "provider_resources" pr
USING resource_merge_map mm
WHERE pr.id = mm.loser_id;

DROP TABLE resource_dedup;
DROP TABLE resource_merge_map;

-- 3. Now that every row is backfilled and duplicates are gone, lock the
--    new identity column down and swap the unique constraint.
ALTER TABLE "provider_resources" ALTER COLUMN "providerConnectionId" SET NOT NULL;

ALTER TABLE "provider_resources"
  ADD CONSTRAINT "provider_resources_providerConnectionId_fkey"
  FOREIGN KEY ("providerConnectionId") REFERENCES "provider_connections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "provider_resources_providerAccountId_externalResourceId_key";

CREATE UNIQUE INDEX "provider_resources_providerConnectionId_resourceType_exte_key"
  ON "provider_resources"("providerConnectionId", "resourceType", "externalResourceId");
