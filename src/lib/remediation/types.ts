// Remediation actions are kept deliberately separate from provider adapters
// (lib/providers/*) — a normal cost sync must never be able to accidentally
// trigger a stop action. Only the budget-threshold evaluation job calls into
// this module, and only when `Budget.hardStopEnabled` is true and the owner
// has completed the one-time confirmation flow (spec §34.11).

import type { StopActionCapability } from '@/lib/providers/types';

export interface RemediationTarget {
  /** e.g. a GCP project id, an OpenAI project id, an Anthropic workspace id */
  scopeExternalId: string;
  managedAppId: string;
  budgetId: string;
}

export interface StopActionResult {
  ok: boolean;
  capabilityUsed: StopActionCapability;
  message: string;
  /**
   * Snapshot of whatever was true immediately before the action, sufficient
   * to reverse exactly this action later (persisted to
   * BudgetEvent.preActionStateJson). Never resume from a guess — if this is
   * empty, resume must fail closed and ask for manual verification.
   */
  preActionState: Record<string, unknown>;
  providerResponse?: unknown;
}

export interface ResumeActionResult {
  ok: boolean;
  message: string;
  providerResponse?: unknown;
}

export interface RemediationAdapter {
  provider: 'GOOGLE_CLOUD' | 'OPENAI' | 'ANTHROPIC';

  /** What would actually happen if `stop` were called right now, for this target. */
  describeStopAction(target: RemediationTarget): Promise<{
    capability: StopActionCapability;
    description: string;
  }>;

  stop(target: RemediationTarget): Promise<StopActionResult>;

  /** Reverses exactly the action recorded in `preActionState` — nothing else. */
  resume(
    target: RemediationTarget,
    preActionState: Record<string, unknown>,
  ): Promise<ResumeActionResult>;
}
