// Billing export to BigQuery — the financial source of truth (spec §5.3,
// §5.4). Google can issue late corrections to already-exported rows for a
// few days, so every query here is re-run and upserted by natural key
// (see prisma/schema.prisma CostRecord) rather than inserted once and
// forgotten.

import { BigQuery } from '@google-cloud/bigquery';
import type { OAuth2Client } from 'google-auth-library';
import type { BillingExportConfig } from './config';

export function standardTableId(billingAccountId: string): string {
  return `gcp_billing_export_v1_${billingAccountId.replace(/-/g, '_')}`;
}

export function detailedTableId(billingAccountId: string): string {
  return `gcp_billing_export_resource_v1_${billingAccountId.replace(/-/g, '_')}`;
}

export interface BillingExportTestResult {
  datasetReachable: boolean;
  hasStandardExport: boolean;
  hasDetailedExport: boolean;
  standardTableId: string;
  detailedTableId: string;
  message: string;
}

/**
 * Setup wizard step 4 (spec §17): detect whether the export exists at all,
 * and whether the richer Detailed export (preferred, spec §5.3) is present
 * alongside the Standard one. Never throws for "not configured yet" — that's
 * an expected state during onboarding, not a bug.
 */
export async function testBillingExport(
  config: BillingExportConfig,
  billingAccountId: string,
  authClient?: OAuth2Client,
): Promise<BillingExportTestResult> {
  const standard = standardTableId(billingAccountId);
  const detailed = detailedTableId(billingAccountId);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- google-auth-library's generic AuthClient union type does not include OAuth2Client, though it accepts one at runtime.
    const bq = new BigQuery({ projectId: config.exportProjectId, ...(authClient ? ({ authClient } as any) : {}) });
    const [tables] = await bq.dataset(config.datasetId).getTables();
    const tableIds = new Set(tables.map((t) => t.id));

    const hasStandardExport = tableIds.has(standard);
    const hasDetailedExport = tableIds.has(detailed);

    return {
      datasetReachable: true,
      hasStandardExport,
      hasDetailedExport,
      standardTableId: standard,
      detailedTableId: detailed,
      message:
        hasDetailedExport || hasStandardExport
          ? `נמצא billing export (${hasDetailedExport ? 'detailed' : 'standard'}).`
          : 'ה-dataset נגיש אך billing export עדיין לא מוגדר עבור billing account זה.',
    };
  } catch (err) {
    return {
      datasetReachable: false,
      hasStandardExport: false,
      hasDetailedExport: false,
      standardTableId: standard,
      detailedTableId: detailed,
      message: err instanceof Error ? err.message : 'לא ניתן לגשת ל-BigQuery dataset.',
    };
  }
}

export interface RawCostRow {
  projectId: string;
  usageDate: string; // YYYY-MM-DD
  service: string;
  sku: string;
  currency: string;
  grossCost: number;
  credits: number;
  netCost: number;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregates by (project, day, service, sku, currency) — matches spec §5.4's
 * required granularity (daily/project/service/SKU totals) without pulling
 * every individual line item. Gross/credits/net are computed exactly the way
 * Google's own billing export documentation recommends, so "Do not double
 * count credits" (spec §5.4) holds by construction: credits are already
 * negative in the export, net = gross + credits.
 */
export async function queryDailyCosts(
  config: BillingExportConfig,
  billingAccountId: string,
  useDetailedExport: boolean,
  from: Date,
  to: Date,
  authClient?: OAuth2Client,
): Promise<RawCostRow[]> {
  const table = useDetailedExport
    ? detailedTableId(billingAccountId)
    : standardTableId(billingAccountId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see testBillingExport above
  const bq = new BigQuery({ projectId: config.exportProjectId, ...(authClient ? ({ authClient } as any) : {}) });

  const query = `
    SELECT
      project.id AS project_id,
      DATE(usage_start_time, @timezone) AS usage_date,
      IFNULL(service.description, '') AS service,
      IFNULL(sku.description, '') AS sku,
      currency,
      SUM(cost) AS gross_cost,
      SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)) AS credits,
      SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)) AS net_cost
    FROM \`${config.exportProjectId}.${config.datasetId}.${table}\`
    WHERE DATE(usage_start_time, @timezone) BETWEEN @fromDate AND @toDate
      AND project.id IS NOT NULL
    GROUP BY project_id, usage_date, service, sku, currency
  `;

  const [rows] = await bq.query({
    query,
    params: {
      timezone: config.timezone,
      fromDate: toDateOnly(from),
      toDate: toDateOnly(to),
    },
  });

  return (rows as Record<string, unknown>[]).map((row) => ({
    projectId: String(row.project_id),
    usageDate: String(
      typeof row.usage_date === 'object' && row.usage_date !== null && 'value' in row.usage_date
        ? (row.usage_date as { value: string }).value
        : row.usage_date,
    ),
    service: String(row.service ?? ''),
    sku: String(row.sku ?? ''),
    currency: String(row.currency),
    grossCost: Number(row.gross_cost ?? 0),
    credits: Number(row.credits ?? 0),
    netCost: Number(row.net_cost ?? 0),
  }));
}
