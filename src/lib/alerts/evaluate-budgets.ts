// Budget threshold evaluation (spec §5.8 forecast, §14 alerts, §34.6 audit
// trail). Pure alerting for now — does NOT execute Hard Stop actions even
// when a threshold's actionType is TRIGGER_HARD_STOP or the budget has
// hardStopEnabled=true. Wiring evaluation → lib/remediation execution is a
// deliberately separate next step (see README "Next steps") so alerting can
// be verified working on its own before anything destructive is automated.

import { prisma } from '@/lib/db/prisma';
import { sendAlertEmail, budgetAlertEmailHtml } from '@/lib/notify/email';
import { monthProgress, projectedMonthEnd } from '@/lib/forecast/mtd';
import type { AlertSeverity, BudgetEventType } from '@prisma/client';

function cycleKeyFor(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function severityFor(percent: number): AlertSeverity {
  if (percent >= 100) return 'CRITICAL';
  if (percent >= 90) return 'HIGH';
  if (percent >= 75) return 'WARNING';
  return 'INFO';
}

function budgetEventTypeFor(percent: number): BudgetEventType {
  if (percent >= 100) return 'HARD_LIMIT_REACHED';
  if (percent >= 90) return 'BUDGET_CRITICAL';
  return 'BUDGET_WARNING';
}

export interface BudgetEvaluationSummary {
  budgetsEvaluated: number;
  alertsSent: number;
  errors: string[];
}

/**
 * Evaluates every active, project-scoped Google budget against this month's
 * actual spend. Anti-spam per spec §14: a given threshold alerts at most
 * once per monthly cycle (BudgetThreshold.triggerCycleKey), and re-running
 * this job (e.g. every 3h alongside the cost sync) is always safe — already-
 * fired thresholds are simply skipped until the next billing cycle resets
 * them.
 */
export async function evaluateGoogleBudgets(now: Date = new Date()): Promise<BudgetEvaluationSummary> {
  const errors: string[] = [];
  let alertsSent = 0;
  const cycleKey = cycleKeyFor(now);

  // PROVIDER_RESOURCE = one GCP project/resource. MANAGED_APP = every
  // resource mapped to a site combined (spec intent: "did the whole site
  // cross its budget", not just one of the projects behind it — a site
  // like Mishpatly spans its main Cloud Run project *and* a separate
  // Gemini/AI project, and a per-resource budget alone would silently miss
  // the AI slice). PROVIDER_ACCOUNT (whole billing account) has no UI to
  // create one yet, so it's not evaluated here.
  const budgets = await prisma.budget.findMany({
    where: {
      provider: 'GOOGLE_CLOUD',
      active: true,
      scopeType: { in: ['PROVIDER_RESOURCE', 'MANAGED_APP'] },
    },
    include: { thresholds: true },
  });

  const { monthStart, elapsedDays, totalDays } = monthProgress(now);

  for (const budget of budgets) {
    try {
      let spend: number;
      let appName: string;
      let resourceLabel: string;
      let dashboardManagedAppId: string | null;

      if (budget.scopeType === 'MANAGED_APP') {
        const app = await prisma.managedApp.findUnique({ where: { id: budget.scopeId } });
        if (!app) continue;

        const spendResult = await prisma.costRecord.aggregate({
          where: { managedAppId: app.id, usageDate: { gte: monthStart } },
          _sum: { netCost: true },
        });
        spend = Number(spendResult._sum.netCost ?? 0);
        appName = app.name;
        resourceLabel = 'כל המשאבים הממופים';
        dashboardManagedAppId = app.id;
      } else {
        const resource = await prisma.providerResource.findUnique({
          where: { id: budget.scopeId },
          include: { appMappings: { include: { managedApp: true } } },
        });
        if (!resource) continue;

        const spendResult = await prisma.costRecord.aggregate({
          where: { providerResourceId: resource.id, usageDate: { gte: monthStart } },
          _sum: { netCost: true },
        });
        spend = Number(spendResult._sum.netCost ?? 0);
        appName = resource.appMappings[0]?.managedApp?.name ?? resource.displayName;
        resourceLabel = resource.externalResourceId;
        dashboardManagedAppId = resource.appMappings[0]?.managedAppId ?? null;
      }

      const budgetAmount = Number(budget.amount);
      const percentConsumed = budgetAmount > 0 ? (spend / budgetAmount) * 100 : 0;
      const forecastMonthEnd = projectedMonthEnd(spend, elapsedDays, totalDays);

      // Only thresholds we've reached AND haven't already alerted on this
      // cycle — "escalate only when crossing a new threshold" (spec §14).
      const dueThresholds = budget.thresholds
        .filter((t) => percentConsumed >= Number(t.percent))
        .filter((t) => t.triggerCycleKey !== cycleKey)
        .sort((a, b) => Number(a.percent) - Number(b.percent));

      for (const threshold of dueThresholds) {
        const percent = Number(threshold.percent);
        const dashboardUrl = dashboardManagedAppId
          ? `${process.env.APP_URL ?? ''}/apps/${dashboardManagedAppId}`
          : '';

        try {
          await sendAlertEmail({
            to: threshold.notifyEmail ?? undefined,
            subject: `[PAY SCOPE] ${appName} — ${percent}% מהתקציב`,
            text:
              `${appName} (${resourceLabel})\n` +
              `הוצאה החודש: ${spend.toFixed(2)} ${budget.currency}\n` +
              `תקציב: ${budgetAmount.toFixed(2)} ${budget.currency}\n` +
              `ניצול: ${percentConsumed.toFixed(1)}%\n` +
              `תחזית לסוף החודש: ${forecastMonthEnd.toFixed(2)} ${budget.currency}\n` +
              (dashboardUrl ? `${dashboardUrl}\n` : ''),
            html: budgetAlertEmailHtml({
              appName,
              externalResourceId: resourceLabel,
              spend,
              budgetAmount,
              currency: budget.currency,
              percentConsumed,
              forecastMonthEnd,
              dashboardUrl: dashboardUrl || undefined,
              critical: percent >= 100,
            }),
          });
        } catch (emailErr) {
          // Still record the threshold as evaluated in our own tables (so we
          // don't lose the audit trail / dashboard alert), but surface the
          // send failure distinctly — an unconfigured SMTP shouldn't look
          // identical to "nothing to alert on".
          errors.push(
            `email send failed for ${appName} @ ${percent}%: ` +
              (emailErr instanceof Error ? emailErr.message : 'unknown error'),
          );
        }

        await prisma.budgetThreshold.update({
          where: { id: threshold.id },
          data: { triggeredAt: now, triggerCycleKey: cycleKey },
        });

        await prisma.budgetEvent.create({
          data: {
            budgetId: budget.id,
            eventType: budgetEventTypeFor(percent),
            actor: 'SYSTEM',
            spendAtEvent: spend,
            percentConsumed,
          },
        });

        await prisma.alert.create({
          data: {
            severity: severityFor(percent),
            type: 'budget_threshold',
            provider: 'GOOGLE_CLOUD',
            scopeType: budget.scopeType,
            scopeId: budget.scopeId,
            title: `${appName} — ${percent}% מהתקציב`,
            body:
              `הוצאה: ${spend.toFixed(2)} ${budget.currency} מתוך ${budgetAmount.toFixed(2)} ` +
              `${budget.currency} (${percentConsumed.toFixed(1)}%). תחזית לסוף החודש: ` +
              `${forecastMonthEnd.toFixed(2)} ${budget.currency}.`,
          },
        });

        alertsSent++;
      }
    } catch (err) {
      errors.push(`budget ${budget.id}: ${err instanceof Error ? err.message : 'evaluation failed'}`);
    }
  }

  return { budgetsEvaluated: budgets.length, alertsSent, errors };
}
