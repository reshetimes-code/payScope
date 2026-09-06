// Hard Stop execution (spec §34). Deliberately separate from
// evaluate-budgets.ts — that module only ever sends email, this module is
// the one place in the codebase allowed to call into lib/remediation and
// actually take a destructive action. Keeping them apart means alerting
// keeps working even if something here has a bug, and it's obvious from the
// import graph alone which code path can take a site offline.
//
// Preconditions, all required, all fail closed (skip, not stop) when unmet:
//  - Budget.hardStopEnabled === true (spec §34.11 — never enabled implicitly)
//  - The budget's GCP project has exactly one FULL-mode managed-app mapping
//    (lib/remediation/google.ts#isProjectSharedAcrossApps re-checks this
//    independently at stop time — this is the first, cheaper check)
//  - That app has an explicit Hard Stop target configured
//    (ManagedApp.hardStopCloudRunRegion/hardStopCloudRunServiceName) —
//    there is no way to derive which Cloud Run service to stop from cost
//    data alone, so an unconfigured target is a hard skip, not a guess

import { prisma } from '@/lib/db/prisma';
import { googleRemediationAdapter } from '@/lib/remediation/google';
import { sendAlertEmail } from '@/lib/notify/email';
import { monthProgress } from '@/lib/forecast/mtd';
import { toJsonSafe } from '@/lib/json-safe';

export interface HardStopExecutionSummary {
  budgetsWithHardStopEnabled: number;
  stopped: number;
  skipped: string[];
  errors: string[];
}

async function notify(subject: string, text: string, errors: string[]): Promise<void> {
  try {
    await sendAlertEmail({ subject, text, html: `<pre>${text}</pre>` });
  } catch (err) {
    // A failed Hard Stop notification email is itself worth surfacing loudly
    // (spec §34.5 requires it), but must never be allowed to make the
    // caller think the stop action itself didn't happen — keep it in the
    // errors list, don't throw.
    errors.push(`email send failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}

export async function executeGoogleHardStops(now: Date = new Date()): Promise<HardStopExecutionSummary> {
  const skipped: string[] = [];
  const errors: string[] = [];
  let stopped = 0;

  const budgets = await prisma.budget.findMany({
    where: {
      provider: 'GOOGLE_CLOUD',
      active: true,
      scopeType: 'PROVIDER_RESOURCE',
      hardStopEnabled: true,
    },
  });

  const { monthStart } = monthProgress(now);

  for (const budget of budgets) {
    try {
      const resource = await prisma.providerResource.findUnique({
        where: { id: budget.scopeId },
        include: { appMappings: { include: { managedApp: true } } },
      });
      if (!resource) {
        skipped.push(`budget ${budget.id}: provider resource no longer exists`);
        continue;
      }

      const fullMappings = resource.appMappings.filter((m) => m.allocationMode === 'FULL');
      if (fullMappings.length !== 1) {
        skipped.push(
          `${resource.displayName}: ${fullMappings.length} dedicated app mapping(s), need exactly 1 — not attempting a stop`,
        );
        continue;
      }
      // Safe: length === 1 just confirmed above.
      const app = fullMappings[0]!.managedApp;

      if (!app.hardStopCloudRunRegion || !app.hardStopCloudRunServiceName) {
        skipped.push(`${app.name}: no Hard Stop target configured (region/service name)`);
        continue;
      }

      // Already actively stopped — normal steady state, not logged as
      // skipped noise. Keyed on resumedAt (not "this month"), so a budget
      // increase + manual resume mid-cycle can legitimately re-trigger a
      // stop later in the same cycle if spend crosses the (new) limit again.
      const activeStop = await prisma.budgetEvent.findFirst({
        where: { budgetId: budget.id, eventType: 'HARD_STOP_SUCCEEDED', resumedAt: null },
      });
      if (activeStop) continue;

      const spendResult = await prisma.costRecord.aggregate({
        where: { providerResourceId: resource.id, usageDate: { gte: monthStart } },
        _sum: { netCost: true },
      });
      const spend = Number(spendResult._sum.netCost ?? 0);
      const budgetAmount = Number(budget.amount);
      const percentConsumed = budgetAmount > 0 ? (spend / budgetAmount) * 100 : 0;
      const hardLimitPercent = Number(budget.hardLimitPercent);

      if (percentConsumed < hardLimitPercent) continue; // below threshold — normal, not an error

      await prisma.budgetEvent.create({
        data: {
          budgetId: budget.id,
          eventType: 'HARD_LIMIT_REACHED',
          actor: 'SYSTEM',
          spendAtEvent: spend,
          percentConsumed,
        },
      });
      await prisma.budgetEvent.create({
        data: {
          budgetId: budget.id,
          eventType: 'HARD_STOP_STARTED',
          actor: 'SYSTEM',
          spendAtEvent: spend,
          percentConsumed,
        },
      });

      const scopeExternalId = `${resource.externalResourceId}/${app.hardStopCloudRunRegion}/${app.hardStopCloudRunServiceName}`;
      const result = await googleRemediationAdapter.stop({
        scopeExternalId,
        managedAppId: app.id,
        budgetId: budget.id,
      });

      if (result.ok) {
        await prisma.budgetEvent.create({
          data: {
            budgetId: budget.id,
            eventType: 'HARD_STOP_SUCCEEDED',
            actor: 'SYSTEM',
            spendAtEvent: spend,
            percentConsumed,
            stopActionRequested: result.capabilityUsed,
            stopActionResult: result.message,
            preActionStateJson: toJsonSafe(result.preActionState),
          },
        });
        stopped++;

        await notify(
          `[PAY SCOPE] ${app.name} הושהה עקב חריגה מתקציב`,
          `${app.name} עבר את הרף הקשיח (${hardLimitPercent}%) והושהה אוטומטית.\n\n` +
            `הוצאה החודש: ${spend.toFixed(2)} ${budget.currency}\n` +
            `תקציב: ${budgetAmount.toFixed(2)} ${budget.currency}\n` +
            `פעולה: ${result.message}\n\n` +
            `ניתן להגדיל את התקציב ואז להפעיל מחדש דרך /budgets.`,
          errors,
        );
      } else {
        await prisma.budgetEvent.create({
          data: {
            budgetId: budget.id,
            eventType: 'HARD_STOP_FAILED',
            actor: 'SYSTEM',
            spendAtEvent: spend,
            percentConsumed,
            stopActionRequested: result.capabilityUsed,
            stopActionResult: result.message,
          },
        });
        errors.push(`${app.name}: hard stop failed — ${result.message}`);

        await notify(
          `[PAY SCOPE] כשל בעצירה אוטומטית של ${app.name}`,
          `${app.name} עבר את הרף הקשיח אך ניסיון העצירה האוטומטית נכשל: ${result.message}\n` +
            `נדרשת בדיקה ידנית מיידית — ${app.hardStopCloudRunRegion}/${app.hardStopCloudRunServiceName} ` +
            `בפרויקט ${resource.externalResourceId}.`,
          errors,
        );
      }
    } catch (err) {
      errors.push(`budget ${budget.id}: ${err instanceof Error ? err.message : 'hard stop execution failed'}`);
    }
  }

  return { budgetsWithHardStopEnabled: budgets.length, stopped, skipped, errors };
}
