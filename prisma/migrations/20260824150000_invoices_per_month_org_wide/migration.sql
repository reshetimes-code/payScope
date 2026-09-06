-- Restructure invoices from "one row per billing account per month" to
-- "one row per month, org-wide, with a per-billing-account breakdown".
-- The two rows that exist so far are disposable test-generation output
-- (not real historical records anyone depends on), so this truncates rather
-- than trying to merge them — the generator re-creates them in the new
-- shape on its next run.
TRUNCATE TABLE "invoices";

DROP INDEX "invoices_billingAccountId_periodStart_key";

ALTER TABLE "invoices" DROP COLUMN "billingAccountId";
ALTER TABLE "invoices" DROP COLUMN "billingAccountName";
ALTER TABLE "invoices" ADD COLUMN "organizationName" TEXT NOT NULL;
ALTER TABLE "invoices" ADD COLUMN "breakdownJson" JSONB NOT NULL;

CREATE UNIQUE INDEX "invoices_periodStart_key" ON "invoices"("periodStart");
