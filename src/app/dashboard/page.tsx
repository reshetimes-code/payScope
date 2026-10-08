import type { ReactNode } from 'react';
import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { monthProgress, projectedMonthEnd } from '@/lib/forecast/mtd';
import { getUsdToIlsRate } from '@/lib/fx/rate';
import { SyncNowButton } from '@/components/sync-now-button';
import { TableRow } from '@/components/table-row';

// Home dashboard (spec §11). Must answer "כמה אני מוציא החודש ועל מה?" within
// 5 seconds. See src/app/google/projects/page.tsx for why this must stay
// dynamic — every number here is live, never statically cached.
export const dynamic = 'force-dynamic';

// No FX conversion is implemented (spec §18 — "If no FX source is
// configured, show totals grouped by currency instead of inventing a
// conversion"), so every total here is a map of currency → amount, not a
// single blended number.
function formatByCurrency(byCurrency: Map<string, number>): string {
  if (byCurrency.size === 0) return '—';
  return [...byCurrency.entries()]
    .map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`)
    .join(' + ');
}

const MONTHS_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const RENDER_TYPE_LABELS: Record<string, string> = {
  web_service: 'Web Service',
  static_site: 'Static Site',
  background_worker: 'Background Worker',
  private_service: 'Private Service',
  cron_job: 'Cron Job',
};

const RENDER_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  live: { label: 'Deployed', className: 'text-green-400' },
  available: { label: 'Available', className: 'text-green-400' },
  build_failed: { label: 'Failed deploy', className: 'text-red-400' },
  update_failed: { label: 'Failed deploy', className: 'text-red-400' },
  deploy_failed: { label: 'Failed deploy', className: 'text-red-400' },
  canceled: { label: 'Canceled', className: 'text-stone-500' },
  deactivated: { label: 'Deactivated', className: 'text-stone-500' },
  suspended: { label: 'Suspended', className: 'text-orange-400' },
  building: { label: 'Building', className: 'text-yellow-400' },
  deploying: { label: 'Deploying', className: 'text-yellow-400' },
  queued: { label: 'Queued', className: 'text-yellow-400' },
  created: { label: 'Created', className: 'text-stone-400' },
  unknown: { label: 'Unknown', className: 'text-stone-500' },
};

export default async function DashboardPage() {
  const { monthStart, elapsedDays, totalDays } = monthProgress();

  const [spendRows, budgetRows, openAlerts, sites, unmappedGoogleResources, connection] = await Promise.all([
    prisma.costRecord.groupBy({
      by: ['currency'],
      where: { usageDate: { gte: monthStart } },
      _sum: { netCost: true },
    }),
    prisma.budget.findMany({ where: { active: true } }),
    prisma.alert.count({ where: { status: 'OPEN' } }),
    prisma.managedApp.findMany({
      include: {
        resourceMappings: { include: { providerResource: { include: { account: true } } } },
        budgets: true,
      },
      orderBy: { name: 'asc' },
    }),
    // Fetched in full (not just counted) so newly-discovered GCP projects can
    // show up as their own rows in the "שרת Google" table below right after
    // a sync — not just as a "N unmapped" banner requiring a trip to /apps
    // first. A GCP project still isn't a "site" until someone maps it (spec
    // §2), so these render as a distinct, clearly-unmapped row, not a real
    // site row.
    prisma.providerResource.findMany({
      where: { resourceType: 'gcp_project', appMappings: { none: {} } },
      include: { account: true },
      orderBy: { displayName: 'asc' },
    }),
    prisma.providerConnection.findFirst({ where: { provider: 'GOOGLE_CLOUD' } }),
  ]);
  // Mishpatly moved to its own dedicated Google billing account (a separate
  // Google account, free-trial credit) hosting just this one site — shown in
  // its own table instead of the shared "שרת Google" one (owner request).
  const MISHPATLY_SERVER = {
    billingAccountId: '01E827-C97C35-0E6222',
    accountEmail: 'msptly7@gmail.com',
    domain: 'mishpatly.co.il',
  };
  const isMishpatly = (s: { name: string; domain: string | null }) =>
    s.domain === MISHPATLY_SERVER.domain || s.name.toLowerCase() === 'mishpatly';
  const mishpatlySites = sites.filter(isMishpatly);
  const mainSites = sites.filter((s) => !isMishpatly(s));
  const sitesCount = sites.length;
  const unmappedCount = unmappedGoogleResources.length;

  // Render — inventory only (owner request), no cost data: see
  // lib/providers/render/adapter.ts capabilities comment.
  const [renderResources, renderConnection, latestRenderInvoice] = await Promise.all([
    prisma.providerResource.findMany({
      where: { connection: { provider: 'RENDER' } },
      orderBy: { displayName: 'asc' },
    }),
    prisma.providerConnection.findFirst({ where: { provider: 'RENDER' } }),
    // The real, final total for the last *closed* month — from the same
    // Invoice table Google's row lives in (/invoices, entered via
    // /invoices/render/new). Kept separate from the in-progress-month
    // number below: conflating "final" with "still accruing" is exactly
    // what confused the owner into thinking a stale mid-month snapshot was
    // August's real total.
    prisma.invoice.findFirst({ where: { provider: 'RENDER' }, orderBy: { periodStart: 'desc' } }),
  ]);
  // Render has no cost API at all (flat-rate plans, not metered — see the
  // adapter comment), so this is the owner's own number typed in from
  // Render's Billing → Unbilled Charges page, not a live sync. Shown with
  // its own manual-entry timestamp so it never masquerades as live data.
  // paymentCard/bankName/accountEmail are likewise manual — which real card
  // funds this provider, for the owner to hand to whoever pays the bill.
  interface ManualPaymentInfo {
    paymentCard?: string;
    bankName?: string;
    accountEmail?: string;
  }
  const renderManualCost = renderConnection?.metadataJson as
    | (ManualPaymentInfo & {
        manualMonthToDateUsd?: number;
        manualProjectedMonthUsd?: number;
        manualEnteredAt?: string;
      })
    | null;
  const googlePaymentInfo = connection?.metadataJson as ManualPaymentInfo | null;
  // Google Cloud Console honors ?authuser=<email> to open directly under a
  // specific signed-in Google account instead of whichever one happens to
  // be active in the browser — important here since the browser clicking
  // this link is often signed in as a *different* Google account than the
  // one that owns the billing (owner request).
  const googleAuthUserParam = googlePaymentInfo?.accountEmail
    ? `?authuser=${encodeURIComponent(googlePaymentInfo.accountEmail)}`
    : '';

  // Claude — owner's personal Claude.ai subscription (Max/Pro), a fixed
  // monthly price with no usage API at all (unlike the Anthropic Console
  // Admin API this app could otherwise sync from — see /providers/anthropic,
  // still "Coming Soon"). Manual, same as Render's cost line.
  const claudeConnection = await prisma.providerConnection.findFirst({ where: { provider: 'ANTHROPIC' } });
  const claudeInfo = claudeConnection?.metadataJson as
    | (ManualPaymentInfo & {
        manualPlanName?: string;
        manualMonthlyCost?: number;
        manualCurrency?: string;
        manualRenewsAt?: string;
        manualEnteredAt?: string;
      })
    | null;

  // Friendly "BILLING N" labels instead of raw account IDs — sorted
  // alphabetically by the real ID so the numbering is stable across
  // requests (not tied to discovery order, which can vary).
  const billingAccountLabels = new Map(
    [
      ...new Set([
        ...sites.flatMap((s) => s.resourceMappings.map((m) => m.providerResource.account.externalAccountId)),
        ...unmappedGoogleResources.map((r) => r.account.externalAccountId),
      ]),
    ]
      .sort()
      .map((id, i) => [id, `BILLING ${i + 1}`]),
  );

  const siteSpend = await prisma.costRecord.groupBy({
    by: ['managedAppId', 'currency'],
    where: { usageDate: { gte: monthStart }, managedAppId: { not: null } },
    _sum: { netCost: true },
  });
  // Currency comes from the cost data itself, not from whether a budget
  // happens to exist yet — a site with real spend but no budget must still
  // show its currency, not a bare unlabeled number.
  const spendBySite = new Map(
    siteSpend.map((s) => [s.managedAppId, { amount: Number(s._sum.netCost ?? 0), currency: s.currency }]),
  );

  const spendByCurrency = new Map(spendRows.map((r) => [r.currency, Number(r._sum.netCost ?? 0)]));

  // "סה״כ הוצאות החודש" (owner request) folds in Render + Claude too — but
  // only for that one display, never into budgetByCurrency/forecast/
  // utilization below, since those derive real percentages that would
  // become misleading once a currency they don't have a matching budget in
  // enters the mix. Claude's cost is ILS, same as Google's, so it's a real
  // sum, not an invented conversion. Render's is USD — converted to ILS
  // using a live sourced rate (getUsdToIlsRate — never an invented number,
  // spec §18) so everything folds into one ILS figure; if that rate can't
  // be fetched right now, USD is kept as its own bucket instead
  // (formatByCurrency's "+" join) rather than silently guessing a rate.
  // Fetched once, reused for both the spend total below and the budget
  // total further down — one live-rate lookup per page render, not two.
  const usdToIls = renderManualCost?.manualMonthToDateUsd != null || renderManualCost?.manualProjectedMonthUsd != null
    ? await getUsdToIlsRate()
    : null;

  const totalSpendByCurrency = new Map(spendByCurrency);
  if (claudeInfo?.manualMonthlyCost != null && claudeInfo.manualCurrency) {
    totalSpendByCurrency.set(
      claudeInfo.manualCurrency,
      (totalSpendByCurrency.get(claudeInfo.manualCurrency) ?? 0) + claudeInfo.manualMonthlyCost,
    );
  }
  let usdFxNote: string | null = null;
  if (renderManualCost?.manualMonthToDateUsd != null) {
    const usdAmount = renderManualCost.manualMonthToDateUsd;
    if (usdToIls) {
      totalSpendByCurrency.set('ILS', (totalSpendByCurrency.get('ILS') ?? 0) + usdAmount * usdToIls.rate);
      usdFxNote = `כולל ${usdAmount.toFixed(2)}$ מ-Render, לפי שער ${usdToIls.rate.toFixed(3)} מ-${usdToIls.asOf}`;
    } else {
      totalSpendByCurrency.set('USD', (totalSpendByCurrency.get('USD') ?? 0) + usdAmount);
    }
  }

  const budgetByCurrency = new Map<string, number>();
  for (const b of budgetRows) {
    budgetByCurrency.set(b.currency, (budgetByCurrency.get(b.currency) ?? 0) + Number(b.amount));
  }

  // "תקציב חודשי כולל" (owner request) — same fold-in as spend above, kept
  // to a separate map for the same reason: utilizationPercent below must
  // keep using the Google-only budgetByCurrency, or a currency it has no
  // matching spend bucket for would silently break its single-currency
  // guard. Render has no real "budget" concept at all (see
  // lib/providers/render/adapter.ts) — its month-end *projection* stands in
  // for one here, since that's the closest thing to "what I expect to owe
  // this month" it has.
  const totalBudgetByCurrency = new Map(budgetByCurrency);
  if (claudeInfo?.manualMonthlyCost != null && claudeInfo.manualCurrency) {
    totalBudgetByCurrency.set(
      claudeInfo.manualCurrency,
      (totalBudgetByCurrency.get(claudeInfo.manualCurrency) ?? 0) + claudeInfo.manualMonthlyCost,
    );
  }
  if (renderManualCost?.manualProjectedMonthUsd != null) {
    const usdAmount = renderManualCost.manualProjectedMonthUsd;
    if (usdToIls) {
      totalBudgetByCurrency.set('ILS', (totalBudgetByCurrency.get('ILS') ?? 0) + usdAmount * usdToIls.rate);
    } else {
      totalBudgetByCurrency.set('USD', (totalBudgetByCurrency.get('USD') ?? 0) + usdAmount);
    }
  }

  const forecastByCurrency = new Map(
    [...spendByCurrency.entries()].map(([currency, spend]) => [
      currency,
      projectedMonthEnd(spend, elapsedDays, totalDays),
    ]),
  );

  // Utilization % only makes sense when exactly one currency is in play on
  // both sides — otherwise summing across currencies would silently invent
  // a conversion rate of 1:1, which is exactly what spec §18 forbids.
  const currencies = new Set([...spendByCurrency.keys(), ...budgetByCurrency.keys()]);
  let utilizationPercent: number | null = null;
  if (currencies.size === 1) {
    // Safe: size === 1 just confirmed above.
    const currency = [...currencies][0]!;
    const budget = budgetByCurrency.get(currency) ?? 0;
    const spend = spendByCurrency.get(currency) ?? 0;
    if (budget > 0) utilizationPercent = (spend / budget) * 100;
  }

  // "At risk" — active budgets whose current spend is already ≥90% of the
  // limit. Reuses the same per-budget spend lookup as /budgets and
  // execute-hard-stops.ts so the number matches what those pages show.
  let atRiskCount = 0;
  for (const b of budgetRows) {
    if (b.scopeType !== 'PROVIDER_RESOURCE' && b.scopeType !== 'MANAGED_APP') continue;
    const sum = await prisma.costRecord.aggregate({
      where:
        b.scopeType === 'MANAGED_APP'
          ? { managedAppId: b.scopeId, usageDate: { gte: monthStart } }
          : { providerResourceId: b.scopeId, usageDate: { gte: monthStart } },
      _sum: { netCost: true },
    });
    const spend = Number(sum._sum.netCost ?? 0);
    const percent = Number(b.amount) > 0 ? (spend / Number(b.amount)) * 100 : 0;
    if (percent >= 90) atRiskCount++;
  }

  const renderSiteRow = (site: (typeof sites)[number], authUserParam: string, billingCellOverride?: ReactNode) => {
      const spendEntry = spendBySite.get(site.id);
      const spend = spendEntry?.amount ?? 0;
      const spendCurrency = spendEntry?.currency ?? '';
      // Budgets set from /budgets are scoped to a single GCP project
      // (PROVIDER_RESOURCE, managedAppId unset), so a site-level budget alone
      // would miss them — fall back to one on any project mapped to this site.
      const mappedResourceIds = new Set(site.resourceMappings.map((m) => m.providerResourceId));
      const budget =
        site.budgets[0] ??
        budgetRows.find((b) => b.scopeType === 'PROVIDER_RESOURCE' && mappedResourceIds.has(b.scopeId));
      const budgetAmount = budget ? Number(budget.amount) : null;
      const percent = budgetAmount && budgetAmount > 0 ? (spend / budgetAmount) * 100 : null;
      // A site can (rarely) span resources on more than one
      // billing account — show every distinct one, not just the
      // first, so nothing is silently hidden.
      const billingAccounts = [
        ...new Map(
          site.resourceMappings.map((m) => [
            m.providerResource.account.externalAccountId,
            m.providerResource.account,
          ]),
        ).values(),
      ];

      return (
        <TableRow
          key={site.id}
          cells={[
            {
              header: 'קישור לאתר',
              content: site.domain ? (
                <a
                  href={`https://${site.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`פתח את ${site.domain}`}
                  className="text-stone-500 hover:text-purple-400"
                >
                  {/* External-link icon — opens the site's real live URL, not this app */}
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M6.5 3.5H3.5A1.5 1.5 0 0 0 2 5v7.5A1.5 1.5 0 0 0 3.5 14H11a1.5 1.5 0 0 0 1.5-1.5V9.5M9.5 2H14v4.5M14 2 7 9"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>
              ) : (
                <span className="text-stone-700" title="אין כתובת ידועה לאתר זה">
                  —
                </span>
              ),
            },
            {
              header: 'אתר',
              primary: true,
              content: (
                <Link href={`/apps/${site.id}`} className="link-strong">
                  {site.name}
                </Link>
              ),
            },
            {
              header: 'חשבון חיוב',
              content:
                billingCellOverride !== undefined ? (
                  billingCellOverride
                ) : billingAccounts.length === 0 ? (
                  <span className="text-stone-700">—</span>
                ) : (
                  <span className="text-xs">
                    {billingAccounts.map((a) => (
                      <div key={a.externalAccountId}>
                        <a
                          href={`https://console.cloud.google.com/billing/${a.externalAccountId}/documents${authUserParam}`}
                          target="_blank"
                          rel="noreferrer"
                          title={`חשבוניות של ${a.displayName} (${a.externalAccountId}) ב-Google Cloud Console`}
                          className="text-stone-400 underline decoration-dotted hover:text-purple-400"
                        >
                          {billingAccountLabels.get(a.externalAccountId)}
                        </a>
                      </div>
                    ))}
                  </span>
                ),
            },
            {
              header: 'משאבים',
              content: <span className="text-xs text-stone-400">{site.resourceMappings.length}</span>,
            },
            {
              header: 'הוצאה החודש',
              content: `${spend.toFixed(2)} ${spendCurrency}`,
            },
            {
              header: 'תקציב',
              content: budgetAmount !== null ? `${budgetAmount.toFixed(2)} ${budget!.currency}` : '—',
            },
            {
              header: 'ניצול',
              primary: true,
              content:
                percent === null ? (
                  '—'
                ) : (
                  <span
                    className={
                      percent >= 100
                        ? 'text-red-400'
                        : percent >= 90
                          ? 'text-orange-400'
                          : percent >= 75
                            ? 'text-yellow-400'
                            : 'text-green-400'
                    }
                  >
                    {percent.toFixed(0)}%
                  </span>
                ),
            },
          ]}
        />
      );
  };

  const cards = [
    { label: 'סה״כ הוצאות החודש', value: formatByCurrency(totalSpendByCurrency) },
    { label: 'תקציב חודשי כולל', value: formatByCurrency(totalBudgetByCurrency), warn: true },
    {
      label: 'ניצול תקציב %',
      value: utilizationPercent === null ? '—' : `${utilizationPercent.toFixed(0)}%`,
    },
    { label: 'תחזית לסוף החודש', value: formatByCurrency(forecastByCurrency), warn: true },
    { label: 'חריגות פעילות', value: String(openAlerts), warn: openAlerts > 0 },
    { label: 'פרויקטים בסיכון', value: String(atRiskCount), warn: atRiskCount > 0 },
  ];

  return (
    <main className="page-shell">
      <div className="flex items-center justify-between">
        <h1 className="page-title">לוח בקרה</h1>
        {connection && <SyncNowButton />}
      </div>

      {!connection ? (
        <p className="mt-2 text-sm text-stone-400">
          אין עדיין חיבור ל-Google Cloud — לך ל-
          <Link href="/providers/google" className="link">
            חיבור Google Cloud
          </Link>{' '}
          כדי להתחיל.
        </p>
      ) : sitesCount === 0 ? (
        <p className="mt-2 text-sm text-stone-400">
          Google Cloud מחובר אך אין עדיין אתרים ממופים — לך ל-
          <Link href="/apps" className="link">
            אתרים
          </Link>{' '}
          כדי למפות פרויקטים לאתרים.
        </p>
      ) : (
        <p className="mt-2 text-sm text-stone-400">
          {sitesCount} אתרים ממופים. אם המספרים למטה מציגים "—", לחץ "סנכרן עלויות
          עכשיו" למעלה.
        </p>
      )}

      {unmappedCount > 0 && (
        <p className="mt-2 rounded-lg bg-orange-500/10 p-3 text-sm text-orange-400 ring-1 ring-inset ring-orange-500/20">
          {unmappedCount} פרויקטי Google Cloud עדיין לא משויכים לאף אתר —{' '}
          <Link href="/apps" className="link">
            טפל בזה
          </Link>
          .
        </p>
      )}

      <section className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="card">
            <div className="stat-label">{card.label}</div>
            {/* dir="ltr" is required here, not cosmetic — without it the
                browser's bidi algorithm reorders a mixed "409.41 ILS +
                3.29 USD" string into unreadable garbage inside this RTL
                page (each currency's number+code is inherently an LTR
                run). */}
            <div dir="ltr" className={`stat-value text-right ${card.warn ? 'text-orange-400' : ''}`}>
              {card.value}
            </div>
          </div>
        ))}
      </section>

      {usdFxNote && <p className="mt-2 text-xs text-stone-500">{usdFxNote}</p>}

      <p className="mt-4 text-xs text-stone-500">
        תחזית מחושבת לפי קצב הוצאה עד כה בחודש (MTD run-rate) — לא הבטחה, רק
        הערכה לפי §5.8 בספק.
      </p>

      {(mainSites.length > 0 || unmappedGoogleResources.length > 0) && (
        <section className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-stone-300">שרת Google</h2>
            <a
              href={`https://console.cloud.google.com/billing${googleAuthUserParam}`}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary !py-1.5 !px-3 text-xs"
            >
              פתח את Billing של Google ↗
            </a>
          </div>
          {googlePaymentInfo?.paymentCard && (
            <p className="mt-1 text-xs text-stone-500">
              יורד מכרטיס <span className="font-medium text-stone-300">{googlePaymentInfo.paymentCard}</span>
              {googlePaymentInfo.bankName && ` — ${googlePaymentInfo.bankName}`}
              {googlePaymentInfo.accountEmail && (
                <>
                  {' '}
                  · תחת חשבון מייל <span dir="ltr" className="font-medium text-stone-300">{googlePaymentInfo.accountEmail}</span>
                </>
              )}
            </p>
          )}
          <div className="mt-2 card-table">
            <table className="w-full text-sm">
              <thead className="table-head hidden md:table-header-group">
                <tr>
                  <th className="p-3"></th>
                  <th className="p-3">אתר</th>
                  <th className="p-3">חשבון חיוב</th>
                  <th className="p-3">משאבים</th>
                  <th className="p-3">הוצאה החודש</th>
                  <th className="p-3">תקציב</th>
                  <th className="p-3">ניצול</th>
                </tr>
              </thead>
              <tbody>
                {mainSites.map((site) => renderSiteRow(site, googleAuthUserParam))}
                {unmappedGoogleResources.map((resource) => (
                  <TableRow
                    key={resource.id}
                    cells={[
                      {
                        header: 'קישור לאתר',
                        content: (
                          <span className="text-stone-700" title="עדיין לא משויך לאתר">
                            —
                          </span>
                        ),
                      },
                      {
                        header: 'אתר',
                        primary: true,
                        content: (
                          <span className="inline-flex items-center gap-2">
                            <span dir="ltr" className="text-stone-300">{resource.displayName}</span>
                            <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-400 ring-1 ring-inset ring-orange-500/20">
                              חדש — לא משויך
                            </span>
                          </span>
                        ),
                      },
                      {
                        header: 'חשבון חיוב',
                        content: (
                          <a
                            href={`https://console.cloud.google.com/billing/${resource.account.externalAccountId}/documents${googleAuthUserParam}`}
                            target="_blank"
                            rel="noreferrer"
                            title={`חשבוניות של ${resource.account.displayName} (${resource.account.externalAccountId}) ב-Google Cloud Console`}
                            className="text-xs text-stone-400 underline decoration-dotted hover:text-purple-400"
                          >
                            {billingAccountLabels.get(resource.account.externalAccountId)}
                          </a>
                        ),
                      },
                      {
                        header: 'משאבים',
                        content: <span className="text-xs text-stone-400">1</span>,
                      },
                      {
                        header: 'הוצאה החודש',
                        content: <span className="text-stone-700">—</span>,
                      },
                      {
                        header: 'תקציב',
                        content: <span className="text-stone-700">—</span>,
                      },
                      {
                        header: 'ניצול',
                        primary: true,
                        content: (
                          <Link href="/apps" className="link">
                            מפה לאתר ←
                          </Link>
                        ),
                      },
                    ]}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {mishpatlySites.length > 0 && (
        <section className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-stone-300">שרת משפט לי (שרת ייעודי)</h2>
            <a
              href={`https://console.cloud.google.com/billing/${MISHPATLY_SERVER.billingAccountId}?authuser=${encodeURIComponent(MISHPATLY_SERVER.accountEmail)}`}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary !py-1.5 !px-3 text-xs"
            >
              פתח את Billing של משפט לי ↗
            </a>
          </div>
          <p className="mt-1 text-xs text-stone-500">
            חשבון חיוב נפרד, רק לאתר הזה · תחת חשבון מייל{' '}
            <span dir="ltr" className="font-medium text-stone-300">{MISHPATLY_SERVER.accountEmail}</span>
          </p>
          <div className="mt-2 card-table">
            <table className="w-full text-sm">
              <thead className="table-head hidden md:table-header-group">
                <tr>
                  <th className="p-3"></th>
                  <th className="p-3">אתר</th>
                  <th className="p-3">חשבון חיוב</th>
                  <th className="p-3">משאבים</th>
                  <th className="p-3">הוצאה החודש</th>
                  <th className="p-3">תקציב</th>
                  <th className="p-3">ניצול</th>
                </tr>
              </thead>
              <tbody>
                {mishpatlySites.map((site) =>
                  renderSiteRow(
                    site,
                    `?authuser=${encodeURIComponent(MISHPATLY_SERVER.accountEmail)}`,
                    <a
                      href={`https://console.cloud.google.com/billing/${MISHPATLY_SERVER.billingAccountId}/documents?authuser=${encodeURIComponent(MISHPATLY_SERVER.accountEmail)}`}
                      target="_blank"
                      rel="noreferrer"
                      title={`חשבוניות של ${MISHPATLY_SERVER.billingAccountId} ב-Google Cloud Console`}
                      className="text-xs text-stone-400 underline decoration-dotted hover:text-purple-400"
                    >
                      <span dir="ltr">{MISHPATLY_SERVER.billingAccountId}</span>
                    </a>,
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {renderResources.length > 0 && (
        <section className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-stone-300">שרת RENDER</h2>
            <a
              href="https://dashboard.render.com/billing"
              target="_blank"
              rel="noreferrer"
              className="btn-secondary !py-1.5 !px-3 text-xs"
            >
              פתח את Billing של Render ↗
            </a>
          </div>
          {renderManualCost?.paymentCard && (
            <p className="mt-1 text-xs text-stone-500">
              יורד מכרטיס <span className="font-medium text-stone-300">{renderManualCost.paymentCard}</span>
              {renderManualCost.bankName && ` — ${renderManualCost.bankName}`}
              {renderManualCost.accountEmail && (
                <>
                  {' '}
                  · תחת חשבון מייל <span dir="ltr" className="font-medium text-stone-300">{renderManualCost.accountEmail}</span>
                </>
              )}
            </p>
          )}
          {renderManualCost?.manualMonthToDateUsd != null && (
            <p className="mt-1 text-xs text-stone-500">
              הוצאה החודש עד כה: <span className="font-medium text-stone-300">${renderManualCost.manualMonthToDateUsd.toFixed(2)}</span>
              {renderManualCost.manualProjectedMonthUsd != null && (
                <>
                  {' '}
                  · תחזית לסוף החודש: <span className="font-medium text-stone-300">${renderManualCost.manualProjectedMonthUsd.toFixed(2)}</span>
                </>
              )}
              {' '}
              (הוזן ידנית{renderManualCost.manualEnteredAt ? ` ב-${new Date(renderManualCost.manualEnteredAt).toLocaleDateString('he-IL')}` : ''}, לא נתון חי — עדיין לא נסגר)
            </p>
          )}
          {latestRenderInvoice && (
            <p className="mt-1 text-xs text-stone-500">
              חודש אחרון שנסגר סופית ({MONTHS_HE[latestRenderInvoice.periodStart.getUTCMonth()]}{' '}
              {latestRenderInvoice.periodStart.getUTCFullYear()}):{' '}
              <span className="font-medium text-stone-300">
                {Number(latestRenderInvoice.totalAmount).toFixed(2)} {latestRenderInvoice.currency}
              </span>{' '}
              ·{' '}
              <a href={`/api/invoices/${latestRenderInvoice.id}/pdf`} className="text-purple-400 hover:text-purple-300">
                PDF
              </a>
            </p>
          )}
          <div className="mt-2 card-table">
            <table className="w-full text-sm">
              <thead className="table-head hidden md:table-header-group">
                <tr>
                  <th className="p-3"></th>
                  <th className="p-3">שם</th>
                  <th className="p-3">סוג</th>
                  <th className="p-3">אזור</th>
                  <th className="p-3">תוכנית</th>
                  <th className="p-3">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {renderResources.map((r) => {
                  const meta = (r.metadataJson as {
                    type?: string;
                    region?: string;
                    plan?: string;
                    url?: string;
                    dashboardUrl?: string;
                  } | null) ?? {};
                  const typeLabel =
                    r.resourceType === 'render_postgres'
                      ? 'PostgreSQL'
                      : RENDER_TYPE_LABELS[meta.type ?? ''] ?? (meta.type ?? '—');
                  const status = RENDER_STATUS_LABELS[r.status] ?? { label: r.status, className: 'text-stone-400' };
                  const linkHref = meta.url ?? meta.dashboardUrl;

                  return (
                    <TableRow
                      key={r.id}
                      cells={[
                        {
                          header: 'קישור',
                          content: linkHref ? (
                            <a
                              href={linkHref}
                              target="_blank"
                              rel="noreferrer"
                              title={`פתח את ${r.displayName}`}
                              className="text-stone-500 hover:text-purple-400"
                            >
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                <path
                                  d="M6.5 3.5H3.5A1.5 1.5 0 0 0 2 5v7.5A1.5 1.5 0 0 0 3.5 14H11a1.5 1.5 0 0 0 1.5-1.5V9.5M9.5 2H14v4.5M14 2 7 9"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </a>
                          ) : (
                            <span className="text-stone-700">—</span>
                          ),
                        },
                        { header: 'שם', primary: true, content: <span dir="ltr">{r.displayName}</span> },
                        { header: 'סוג', content: typeLabel },
                        { header: 'אזור', content: meta.region ?? '—' },
                        { header: 'תוכנית', content: meta.plan ?? '—' },
                        { header: 'סטטוס', primary: true, content: <span className={status.className}>{status.label}</span> },
                      ]}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            אינדיקציה בלבד — ל-Render אין API לעלויות בפועל (תמחור לפי תוכנית קבועה, לא
            שימוש נמדד), אז אין כאן נתוני הוצאה.
          </p>
        </section>
      )}

      {claudeInfo?.manualMonthlyCost != null && (
        <section className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-stone-300">חשבון Claude</h2>
            <a
              href="https://claude.ai/settings/billing"
              target="_blank"
              rel="noreferrer"
              className="btn-secondary !py-1.5 !px-3 text-xs"
            >
              פתח את Billing של Claude ↗
            </a>
          </div>
          {claudeInfo.paymentCard && (
            <p className="mt-1 text-xs text-stone-500">
              יורד מכרטיס <span className="font-medium text-stone-300">{claudeInfo.paymentCard}</span>
              {claudeInfo.bankName && ` — ${claudeInfo.bankName}`}
              {claudeInfo.accountEmail && (
                <>
                  {' '}
                  · תחת חשבון מייל <span dir="ltr" className="font-medium text-stone-300">{claudeInfo.accountEmail}</span>
                </>
              )}
            </p>
          )}
          <div className="mt-2 card-table">
            <table className="w-full text-sm">
              <thead className="table-head hidden md:table-header-group">
                <tr>
                  <th className="p-3">תוכנית</th>
                  <th className="p-3">עלות חודשית</th>
                  <th className="p-3">מתחדש בתאריך</th>
                </tr>
              </thead>
              <tbody>
                <TableRow
                  cells={[
                    { header: 'תוכנית', primary: true, content: claudeInfo.manualPlanName ?? '—' },
                    {
                      header: 'עלות חודשית',
                      primary: true,
                      content: `${claudeInfo.manualMonthlyCost.toFixed(2)} ${claudeInfo.manualCurrency ?? ''}`,
                    },
                    {
                      header: 'מתחדש בתאריך',
                      content: claudeInfo.manualRenewsAt
                        ? new Date(claudeInfo.manualRenewsAt).toLocaleDateString('he-IL')
                        : '—',
                    },
                  ]}
                />
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            מנוי קבוע (לא שימוש נמדד) — אין צורך במעקב תקציב חי. הוזן ידנית
            {claudeInfo.manualEnteredAt ? ` ב-${new Date(claudeInfo.manualEnteredAt).toLocaleDateString('he-IL')}` : ''}.
          </p>
        </section>
      )}
    </main>
  );
}
