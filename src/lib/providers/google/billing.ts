// Cloud Billing API — billing account/project associations (spec §5.2, §5.5).
// Auth: see resource-manager.ts — accepts an optional OAuth2Client, falls back
// to ADC.

import { CloudBillingClient } from '@google-cloud/billing';
import type { OAuth2Client } from 'google-auth-library';

export interface DiscoveredBillingAccount {
  /** e.g. "billingAccounts/012345-6789AB-CDEF01" */
  name: string;
  /** e.g. "012345-6789AB-CDEF01" — used to derive BigQuery export table names (spec §5.3) */
  billingAccountId: string;
  displayName: string;
  open: boolean;
}

export interface ProjectBillingInfo {
  billingAccountName: string | null;
  billingEnabled: boolean;
}

function client(authClient?: OAuth2Client): CloudBillingClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see resource-manager.ts
  return new CloudBillingClient(authClient ? ({ authClient } as any) : {});
}

export async function listBillingAccounts(authClient?: OAuth2Client): Promise<DiscoveredBillingAccount[]> {
  const accounts: DiscoveredBillingAccount[] = [];

  for await (const account of client(authClient).listBillingAccountsAsync({})) {
    if (!account.name) continue;
    accounts.push({
      name: account.name,
      billingAccountId: account.name.replace(/^billingAccounts\//, ''),
      displayName: account.displayName || account.name,
      open: account.open ?? false,
    });
  }

  return accounts;
}

/**
 * Which billing account (if any) a given project is linked to right now.
 * Returns billingEnabled=false / billingAccountName=null for a project with
 * no billing configured — not an error, just a fact to surface in the UI
 * (spec §5.5 "status" column).
 */
export async function getProjectBillingInfo(
  projectId: string,
  authClient?: OAuth2Client,
): Promise<ProjectBillingInfo> {
  const [info] = await client(authClient).getProjectBillingInfo({
    name: `projects/${projectId}`,
  });

  return {
    billingAccountName: info.billingAccountName ?? null,
    billingEnabled: info.billingEnabled ?? false,
  };
}
