-- Invoices become per-provider (owner request: Render needs its own monthly
-- invoice alongside Google's, entered manually since Render has no cost
-- API). Existing rows default to GOOGLE_CLOUD, which is correct — they were
-- all Google org-wide invoices before this migration.
ALTER TABLE "invoices" ADD COLUMN "provider" "Provider" NOT NULL DEFAULT 'GOOGLE_CLOUD';

DROP INDEX "invoices_periodStart_key";
CREATE UNIQUE INDEX "invoices_provider_periodStart_key" ON "invoices"("provider", "periodStart");
