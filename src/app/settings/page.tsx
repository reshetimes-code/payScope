import { TestEmailButton } from '@/components/test-email-button';

// Read-only configuration status — deliberately not an editable settings UI.
// Everything here (SMTP, allow-list, billing export target) is still
// env-var-driven, not stored in the DB, so there is nothing safe to edit
// from a browser yet without first building proper encrypted-at-rest
// settings storage. This page exists to answer "is X configured?" without
// ever displaying a secret value — only presence/absence.
//
// force-dynamic for the same reason as every DB-backed page (see
// src/app/google/projects/page.tsx) even though this one reads env vars,
// not Prisma — a static build would bake in whatever env happened to be
// present at build time, not the actual running deployment's config.
export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const rows: { label: string; configured: boolean; detail?: string }[] = [
    {
      label: 'רשימת אימיילים מורשים להתחברות',
      configured: Boolean(process.env.ALLOWED_ADMIN_EMAILS),
      detail: process.env.ALLOWED_ADMIN_EMAILS
        ? `${process.env.ALLOWED_ADMIN_EMAILS.split(',').length} כתובות`
        : undefined,
    },
    {
      label: 'Google OAuth (login)',
      configured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
    },
    {
      label: 'Google Billing Export (BigQuery)',
      configured: Boolean(
        process.env.GOOGLE_BILLING_EXPORT_LOCATIONS ||
          (process.env.GOOGLE_BILLING_EXPORT_PROJECT_ID && process.env.GOOGLE_BILLING_DATASET_ID),
      ),
      detail: process.env.GOOGLE_BILLING_EXPORT_LOCATIONS
        ? `${process.env.GOOGLE_BILLING_EXPORT_LOCATIONS.split(',').length} billing account(s) מוגדרים בנפרד`
        : process.env.GOOGLE_BILLING_EXPORT_PROJECT_ID && process.env.GOOGLE_BILLING_DATASET_ID
          ? `${process.env.GOOGLE_BILLING_EXPORT_PROJECT_ID}.${process.env.GOOGLE_BILLING_DATASET_ID} (ברירת מחדל יחידה)`
          : undefined,
    },
    {
      label: 'התראות מייל (SMTP)',
      configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.ALERT_TO_EMAIL),
      detail: process.env.ALERT_TO_EMAIL ? `יעד: ${process.env.ALERT_TO_EMAIL}` : undefined,
    },
    {
      label: 'סנכרון פנימי (Cloud Scheduler / OIDC)',
      configured: Boolean(process.env.APP_URL && process.env.CLOUD_SCHEDULER_SERVICE_ACCOUNT_EMAILS),
    },
    {
      label: 'OpenAI / Anthropic',
      configured: Boolean(process.env.OPENAI_ADMIN_KEY || process.env.ANTHROPIC_ADMIN_KEY),
      detail: 'Phase 2 — מחוברים חלקית או לא מחוברים כלל בשלב זה',
    },
  ];

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="page-title">הגדרות</h1>
      <p className="mt-1 text-sm text-stone-400">
        תצוגת מצב בלבד — לא עריכה. כל ההגדרות עדיין מנוהלות דרך משתני סביבה
        (<code dir="ltr">.env.local</code>), לא דרך המסך הזה. אף ערך רגיש לא
        מוצג כאן, רק האם משהו מוגדר או לא.
      </p>

      <ul className="mt-4 divide-y divide-stone-800 rounded-xl border border-stone-800 bg-stone-900 shadow-sm shadow-black/20">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between p-3 text-sm">
            <div>
              <div>{row.label}</div>
              {row.detail && <div className="text-xs text-stone-500" dir="ltr">{row.detail}</div>}
            </div>
            <span
              className={
                row.configured
                  ? 'badge-ok'
                  : 'badge-neutral'
              }
            >
              {row.configured ? 'מוגדר' : 'לא מוגדר'}
            </span>
          </li>
        ))}
      </ul>

      <TestEmailButton />
    </main>
  );
}
