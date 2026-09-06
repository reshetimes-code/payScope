// Central audit log writer — spec §4 "Audit log for every sensitive
// action". Every state-changing Google/OpenAI/Anthropic API route must call
// this, on both the success and failure path.

import { prisma } from '@/lib/db/prisma';
import { toJsonSafe } from '@/lib/json-safe';
import type { Provider, AuditResult } from '@prisma/client';

export interface AuditLogInput {
  actorUserId?: string | null;
  actorLabel: string;
  action: string;
  provider?: Provider;
  resource?: string;
  oldValue?: unknown;
  newValue?: unknown;
  result: AuditResult;
  errorSummary?: string;
  requestCorrelationId?: string;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? undefined,
      actorLabel: input.actorLabel,
      action: input.action,
      provider: input.provider,
      resource: input.resource,
      oldValue: toJsonSafe(input.oldValue),
      newValue: toJsonSafe(input.newValue),
      result: input.result,
      errorSummary: input.errorSummary,
      requestCorrelationId: input.requestCorrelationId,
    },
  });
}
