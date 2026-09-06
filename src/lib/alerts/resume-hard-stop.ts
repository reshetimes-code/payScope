// Hard Stop resume workflow (spec §34.7). Reverses exactly the stop action
// recorded in BudgetEvent.preActionStateJson — never a blind re-enable.
import { prisma } from '@/lib/db/prisma';
import { googleRemediationAdapter } from '@/lib/remediation/google';
import { sendAlertEmail } from '@/lib/notify/email';
import { monthProgress } from '@/lib/forecast/mtd';

export interface ResumeResult {
  ok: boolean;
  message: string;
}

export async function resumeGoogleHardStop(budgetId: string, actorUserId: string | null): Promise<ResumeResult> {
  const budget = await prisma.budget.findUnique({ where: { id: budgetId } });
  if (!budget) return { ok: false, message: 'Budget not found' };

  const activeStop = await prisma.budgetEvent.findFirst({
    where: { budgetId, eventType: 'HARD_STOP_SUCCEEDED', resumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!activeStop) return { ok: false, message: 'אין עצירה פעילה לשחזור עבור תקציב זה.' };
  if (!activeStop.preActionStateJson) {
    return { ok: false, message: 'אין מידע שמור לשחזור בטוח — נדרשת בדיקה ידנית ב-Cloud Console.' };
  }

  const resource = await prisma.providerResource.findUnique({
    where: { id: budget.scopeId },
    include: { appMappings: { include: { managedApp: true } } },
  });
  if (!resource) return { ok: false, message: 'הפרויקט המקורי לא נמצא.' };

  const fullMapping = resource.appMappings.find((m) => m.allocationMode === 'FULL');
  const app = fullMapping?.managedApp;
  if (!app?.hardStopCloudRunRegion || !app.hardStopCloudRunServiceName) {
    return { ok: false, message: 'יעד ה-Hard Stop כבר לא מוגדר.' };
  }

  if (budget.manualResumeRequiresBudgetIncrease) {
    const { monthStart } = monthProgress();
    const spendResult = await prisma.costRecord.aggregate({
      where: { providerResourceId: resource.id, usageDate: { gte: monthStart } },
      _sum: { netCost: true },
    });
    const spend = Number(spendResult._sum.netCost ?? 0);
    const percentConsumed = Number(budget.amount) > 0 ? (spend / Number(budget.amount)) * 100 : 0;
    if (percentConsumed >= Number(budget.hardLimitPercent)) {
      return {
        ok: false,
        message: `עדיין מעל הרף הקשיח (${percentConsumed.toFixed(0)}%) — הגדל את התקציב לפני הפעלה מחדש.`,
      };
    }
  }

  const scopeExternalId = `${resource.externalResourceId}/${app.hardStopCloudRunRegion}/${app.hardStopCloudRunServiceName}`;
  const result = await googleRemediationAdapter.resume(
    { scopeExternalId, managedAppId: app.id, budgetId },
    activeStop.preActionStateJson as Record<string, unknown>,
  );

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.budgetEvent.update({ where: { id: activeStop.id }, data: { resumedAt: now } }),
    prisma.budgetEvent.create({
      data: {
        budgetId,
        eventType: 'MANUAL_RESUME',
        actor: actorUserId ? 'USER' : 'SYSTEM',
        userId: actorUserId ?? undefined,
      },
    }),
  ]);

  try {
    await sendAlertEmail({
      subject: `[PAY SCOPE] ${app.name} הופעל מחדש`,
      text: `${app.name} הופעל מחדש ידנית לאחר Hard Stop.\n${result.message}`,
      html: `<p>${app.name} הופעל מחדש ידנית לאחר Hard Stop.</p><p>${result.message}</p>`,
    });
  } catch {
    // Resume already succeeded and is recorded — a failed confirmation email
    // is not worth failing the whole resume for.
  }

  return { ok: true, message: result.message };
}
