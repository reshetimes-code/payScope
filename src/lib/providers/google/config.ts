// Central place to read + validate Google Cloud connector configuration from
// env. Fails loudly (not silently undefined) when something required for the
// operation being attempted is missing — see each getter's callers.

import { z } from 'zod';

export interface BillingExportConfig {
  exportProjectId: string;
  datasetId: string;
  timezone: string;
}

function timezone(): string {
  return process.env.REPORTING_TIMEZONE || 'Asia/Jerusalem';
}

// Billing export is configured PER billing account in Google's own console
// (spec §5.3) — there is no such thing as one global export location once
// an org has more than one billing account. GOOGLE_BILLING_EXPORT_LOCATIONS
// maps each billing account id to its own project+dataset:
//   012B74-3EBE70-4645B6:silver-503012:billing_export,019253-2FD611-F3FE06:mishpatly:billing_export
// GOOGLE_BILLING_EXPORT_PROJECT_ID/DATASET_ID remain as a fallback default
// for the common single-billing-account case, used only when a given
// billing account has no explicit entry in the map above.
function parseExportLocations(): Map<string, { exportProjectId: string; datasetId: string }> {
  const raw = process.env.GOOGLE_BILLING_EXPORT_LOCATIONS ?? '';
  const map = new Map<string, { exportProjectId: string; datasetId: string }>();

  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [billingAccountId, exportProjectId, datasetId] = entry.split(':').map((s) => s.trim());
    if (!billingAccountId || !exportProjectId || !datasetId) {
      throw new Error(
        `Malformed GOOGLE_BILLING_EXPORT_LOCATIONS entry: "${entry}" — expected billingAccountId:projectId:datasetId`,
      );
    }
    map.set(billingAccountId, { exportProjectId, datasetId });
  }

  return map;
}

/**
 * Resolves the BigQuery export location for a specific billing account.
 * Checks GOOGLE_BILLING_EXPORT_LOCATIONS first (multi-account setups), then
 * falls back to the single default GOOGLE_BILLING_EXPORT_PROJECT_ID/DATASET_ID
 * pair for whichever billing account isn't explicitly listed.
 */
export function getBillingExportConfigFor(billingAccountId: string): BillingExportConfig {
  const perAccount = parseExportLocations().get(billingAccountId);
  if (perAccount) {
    return { ...perAccount, timezone: timezone() };
  }

  const fallbackSchema = z.object({
    exportProjectId: z.string().min(1),
    datasetId: z.string().min(1),
  });
  const parsed = fallbackSchema.safeParse({
    exportProjectId: process.env.GOOGLE_BILLING_EXPORT_PROJECT_ID,
    datasetId: process.env.GOOGLE_BILLING_DATASET_ID,
  });

  if (!parsed.success) {
    throw new Error(
      `Billing export is not configured for billing account ${billingAccountId} — add it to ` +
        'GOOGLE_BILLING_EXPORT_LOCATIONS, or set GOOGLE_BILLING_EXPORT_PROJECT_ID/GOOGLE_BILLING_DATASET_ID ' +
        'as a single-account default. See setup wizard step 4 / spec §5.3.',
    );
  }

  return { ...parsed.data, timezone: timezone() };
}

export function getConfiguredBillingAccountIds(): string[] {
  const raw = process.env.GOOGLE_BILLING_ACCOUNT_IDS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getConfiguredOrgId(): string | null {
  return process.env.GOOGLE_ORG_ID?.trim() || null;
}
