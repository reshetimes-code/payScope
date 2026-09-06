// Provider adapter contract — spec §9, tightened with the capability-driven
// stop-action model from §34.2 and the "provider truth vs internal control"
// rule from §21.
//
// Rule: the UI must render its enforcement/stop-action badges strictly from
// `ProviderCapabilities`/`StopActionCapability` returned here — never
// hardcode "Hard cap" copy per provider inside a page component.

export type ProviderType = 'GOOGLE_CLOUD' | 'OPENAI' | 'ANTHROPIC' | 'RENDER';

// Spec §34.2 — what actually happens, technically, when a stop is executed.
export type StopActionCapability =
  | 'PROVIDER_NATIVE_HARD_LIMIT'
  | 'AUTOMATED_SERVICE_SHUTDOWN' // e.g. Cloud Run max-instances=0 (scoped to one service)
  | 'BILLING_DISCONNECT' // e.g. unlink GCP billing account from project (project-wide — see DECISIONS.md)
  | 'API_KEY_DISABLE_OR_ROTATION' // OpenAI / Anthropic
  | 'MANUAL_ACTION_REQUIRED' // e.g. shared GCP project — no safe automatic action
  | 'MONITORING_ONLY';

export interface ProviderCapabilities {
  canReadCosts: boolean;
  canReadBudgets: boolean;
  canWriteBudgets: boolean;
  hasProviderHardCap: boolean;
  supportsEmergencyShutdown: boolean;
  supportsProjectBreakdown: boolean;
  /** What executing a stop action for this provider/resource actually does. */
  stopAction: StopActionCapability;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  missingPermissions?: string[];
}

export interface ProviderAccountDTO {
  externalAccountId: string;
  displayName: string;
  accountType: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderResourceDTO {
  externalResourceId: string;
  resourceType: string;
  displayName: string;
  status: string;
  parentExternalId?: string;
  metadata?: Record<string, unknown>;
}

export interface CostSyncInput {
  providerAccountExternalId: string;
  /** Inclusive date range, UTC calendar days. */
  from: Date;
  to: Date;
}

export interface NormalizedCostRecord {
  providerResourceExternalId: string;
  usageDate: Date;
  currency: string;
  grossCost: number;
  credits: number;
  netCost: number;
  service?: string;
  sku?: string;
  sourceReference?: string;
  /** Stable hash of the raw provider row — enforces idempotent sync (spec §10 cost_records.raw_hash). */
  rawHash: string;
}

export interface ProviderBudget {
  providerBudgetId: string;
  scopeExternalId: string;
  amount: number;
  currency: string;
  thresholdsPercent: number[];
}

export interface SetBudgetInput {
  scopeExternalId: string;
  amount: number;
  currency: string;
  thresholdsPercent: number[];
}

export interface BudgetActionResult {
  ok: boolean;
  providerBudgetId?: string;
  message: string;
}

export interface ProviderLimit {
  scopeExternalId: string;
  kind: StopActionCapability;
  description: string;
}

export interface SetLimitInput {
  scopeExternalId: string;
  amount: number;
  currency: string;
}

export interface LimitActionResult {
  ok: boolean;
  message: string;
}

/**
 * A provider adapter never contains business logic (thresholds, emailing,
 * anomaly detection) — only the mechanics of talking to one provider. Higher
 * layers (lib/forecast, lib/notify, lib/remediation) stay provider-agnostic.
 */
export interface BillingProviderAdapter {
  provider: ProviderType;
  capabilities: ProviderCapabilities;

  testConnection(): Promise<ConnectionTestResult>;
  discoverAccounts(): Promise<ProviderAccountDTO[]>;
  discoverResources(accountExternalId: string): Promise<ProviderResourceDTO[]>;
  syncCosts(input: CostSyncInput): Promise<NormalizedCostRecord[]>;
  getBudgets(): Promise<ProviderBudget[]>;
  setBudget?(input: SetBudgetInput): Promise<BudgetActionResult>;
  getLimits?(): Promise<ProviderLimit[]>;
  setLimit?(input: SetLimitInput): Promise<LimitActionResult>;
  disconnect(): Promise<void>;
}
