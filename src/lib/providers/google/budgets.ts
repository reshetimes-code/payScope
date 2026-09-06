// Cloud Billing Budget API (spec §5.2, §5.6, §5.7 Mode B). Creating/updating
// a budget here is Mode B — "Provider budget/alert" per the enforcement
// taxonomy (spec §21). It is NOT a spending cap: Google monitors and can
// notify, it does not by itself stop usage. Never let calling code label
// this `PROVIDER_HARD_LIMIT`.
//
// Talks to the REST API directly (spec §32 reference:
// https://docs.cloud.google.com/billing/docs/reference/budget/rest) instead
// of the @google-cloud/billing-budgets client library. That library bundles
// its own google-gax/google-auth-library versions internally, which turned
// out incompatible with the OAuth2Client this app constructs in
// user-auth.ts — both its gRPC transport ("headers.forEach is not a
// function") and REST-fallback transport ("auth.fetch is not a function")
// crashed on a duplicate-package version mismatch. A plain fetch() with a
// bearer token sidesteps the whole problem and has no such fragile
// dependency. resource-manager.ts and billing.ts don't have this issue —
// they don't bundle their own nested google-gax — so they're left as-is.

import { GoogleAuth, type OAuth2Client } from 'google-auth-library';

const API_BASE = 'https://billingbudgets.googleapis.com/v1';

export interface DiscoveredBudget {
  /** Full resource name, e.g. "billingAccounts/XXX/budgets/YYY" — store as Budget.providerBudgetId */
  name: string;
  displayName: string;
  amount: number;
  currencyCode: string;
  thresholdsPercent: number[];
  /** Project numbers this budget's filter is scoped to, e.g. ["123456789012"] */
  scopedProjectNumbers: string[];
}

interface BudgetJson {
  name?: string;
  displayName?: string;
  budgetFilter?: { projects?: string[]; calendarPeriod?: string };
  amount?: { specifiedAmount?: { currencyCode?: string; units?: string | number; nanos?: number } };
  thresholdRules?: { thresholdPercent?: number; spendBasis?: string }[];
}

let cachedFallbackAuth: GoogleAuth | null = null;

/** Falls back to ADC only when no session-based authClient was given —
 * mirrors the option every other Google connector module already accepts. */
async function getAccessToken(authClient?: OAuth2Client): Promise<string> {
  if (authClient) {
    const token = await authClient.getAccessToken();
    if (!token.token) throw new Error('Failed to obtain an access token for the Budget API.');
    return token.token;
  }

  if (!cachedFallbackAuth) {
    cachedFallbackAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  const client = await cachedFallbackAuth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to obtain an ADC access token for the Budget API.');
  return token.token;
}

async function billingBudgetsFetch(
  path: string,
  authClient: OAuth2Client | undefined,
  init: RequestInit = {},
): Promise<unknown> {
  const accessToken = await getAccessToken(authClient);
  const res = await fetch(`${API_BASE}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Budget API ${init.method ?? 'GET'} ${path} failed: ${res.status} ${body}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

function fromBudget(budget: BudgetJson): DiscoveredBudget {
  const units = Number(budget.amount?.specifiedAmount?.units ?? 0);
  const nanos = budget.amount?.specifiedAmount?.nanos ?? 0;

  return {
    name: budget.name ?? '',
    displayName: budget.displayName ?? '',
    amount: units + nanos / 1e9,
    currencyCode: budget.amount?.specifiedAmount?.currencyCode ?? 'USD',
    thresholdsPercent: (budget.thresholdRules ?? [])
      .map((r) => (r.thresholdPercent ?? 0) * 100)
      .sort((a, b) => a - b),
    scopedProjectNumbers: (budget.budgetFilter?.projects ?? []).map((p) => p.replace(/^projects\//, '')),
  };
}

export async function listBudgets(
  billingAccountId: string,
  authClient?: OAuth2Client,
): Promise<DiscoveredBudget[]> {
  const budgets: DiscoveredBudget[] = [];
  let pageToken: string | undefined;

  do {
    const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
    const data = (await billingBudgetsFetch(
      `billingAccounts/${billingAccountId}/budgets${query}`,
      authClient,
    )) as { budgets?: BudgetJson[]; nextPageToken?: string };

    (data.budgets ?? []).forEach((b) => budgets.push(fromBudget(b)));
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return budgets;
}

export interface UpsertBudgetInput {
  billingAccountId: string;
  /** Existing budget resource name to update; omit to create a new one. */
  existingBudgetName?: string;
  displayName: string;
  /** Google Cloud project number (not project id) to scope this budget to. */
  projectNumber: string;
  amount: number;
  currencyCode: string;
  thresholdsPercent: number[];
}

/**
 * Creates or updates a project-scoped budget. Always scopes by project
 * number (spec §34.3 — budgets must be assignable per project, one project
 * exceeding its limit must not implicate others sharing the billing
 * account).
 */
export async function upsertBudget(
  input: UpsertBudgetInput,
  authClient?: OAuth2Client,
): Promise<DiscoveredBudget> {
  const body: BudgetJson = {
    displayName: input.displayName,
    budgetFilter: {
      projects: [`projects/${input.projectNumber}`],
      // Required explicitly by the API now — it no longer silently defaults
      // this. The enum value is "MONTH", not "MONTHLY".
      calendarPeriod: 'MONTH',
    },
    amount: {
      specifiedAmount: {
        currencyCode: input.currencyCode,
        // google.type.Money.units is an int64, which the JSON/REST mapping
        // represents as a *string*, not a number — sending a plain number
        // is also rejected as INVALID_ARGUMENT.
        units: String(Math.trunc(input.amount)),
        nanos: Math.round((input.amount % 1) * 1e9),
      },
    },
    thresholdRules: input.thresholdsPercent.map((percent) => ({
      thresholdPercent: percent / 100,
      spendBasis: 'CURRENT_SPEND',
    })),
  };

  if (input.existingBudgetName) {
    const updateMask = 'displayName,budgetFilter,amount,thresholdRules';
    const updated = await billingBudgetsFetch(
      `${input.existingBudgetName}?updateMask=${updateMask}`,
      authClient,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    return fromBudget(updated as BudgetJson);
  }

  const created = await billingBudgetsFetch(
    `billingAccounts/${input.billingAccountId}/budgets`,
    authClient,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return fromBudget(created as BudgetJson);
}

export async function deleteBudget(budgetName: string, authClient?: OAuth2Client): Promise<void> {
  await billingBudgetsFetch(budgetName, authClient, { method: 'DELETE' });
}
