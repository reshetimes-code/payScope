// Email alerts (spec §14). SMTP-only for v1 — matches the env vars already
// documented in .env.example / spec §28. Fails loudly rather than silently
// dropping an alert: a budget-threshold email that never sends is exactly
// the kind of failure this whole system exists to prevent elsewhere.

import nodemailer from 'nodemailer';

let cachedTransport: nodemailer.Transporter | null = null;

function transport(): nodemailer.Transporter {
  if (cachedTransport) return cachedTransport;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error(
      'SMTP is not configured — set SMTP_HOST/SMTP_USER/SMTP_PASSWORD to send alert emails.',
    );
  }

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return cachedTransport;
}

export interface AlertEmailInput {
  subject: string;
  text: string;
  html: string;
  /** Overrides ALERT_TO_EMAIL for this one send — e.g. a threshold with its
   * own BudgetThreshold.notifyEmail set, distinct from the account-wide
   * default recipient. */
  to?: string;
}

export interface BudgetAlertEmailContent {
  appName: string;
  externalResourceId: string;
  spend: number;
  budgetAmount: number;
  currency: string;
  percentConsumed: number;
  forecastMonthEnd: number;
  dashboardUrl?: string;
  /** True once spend has actually crossed the budget (percent >= 100) —
   * renders as an urgent red card instead of the default amber one. */
  critical: boolean;
}

/** Styled HTML for budget-threshold alerts — plain inline CSS only, no
 * external stylesheet, so it renders consistently across email clients. */
export function budgetAlertEmailHtml(c: BudgetAlertEmailContent): string {
  const accent = c.critical ? '#dc2626' : '#ea580c';
  const accentBg = c.critical ? '#fef2f2' : '#fff7ed';
  const headline = c.critical
    ? `⛔ עברת את התקציב שהגדרת`
    : `⚠️ מתקרב לתקציב שהגדרת`;

  const row = (label: string, value: string, bold = false) => `
    <tr>
      <td style="padding:6px 0;color:#57534e;font-size:14px;">${label}</td>
      <td style="padding:6px 0;color:#1c1917;font-size:14px;text-align:left;${bold ? 'font-weight:700;' : ''}">${value}</td>
    </tr>`;

  return `
  <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;background:#f5f5f4;padding:24px;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e7e5e4;">
      <div style="background:${accent};padding:20px 24px;">
        <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">${headline}</p>
      </div>
      <div style="padding:20px 24px;background:${accentBg};">
        <p style="margin:0 0 12px 0;font-size:16px;font-weight:700;color:#1c1917;">${c.appName}</p>
        <p style="margin:0 0 16px 0;font-size:12px;color:#78716c;" dir="ltr">${c.externalResourceId}</p>
        <table style="width:100%;border-collapse:collapse;">
          ${row('הוצאה החודש', `${c.spend.toFixed(2)} ${c.currency}`, true)}
          ${row('תקציב שהוגדר', `${c.budgetAmount.toFixed(2)} ${c.currency}`)}
          ${row('ניצול', `${c.percentConsumed.toFixed(0)}%`, true)}
          ${row('תחזית לסוף החודש', `${c.forecastMonthEnd.toFixed(2)} ${c.currency}`)}
        </table>
      </div>
      ${
        c.dashboardUrl
          ? `<div style="padding:16px 24px;text-align:center;">
               <a href="${c.dashboardUrl}" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;">פתח ב-PAY SCOPE</a>
             </div>`
          : ''
      }
    </div>
  </div>`;
}

export async function sendAlertEmail(input: AlertEmailInput): Promise<void> {
  const from = process.env.ALERT_FROM_EMAIL;
  const to = input.to ?? process.env.ALERT_TO_EMAIL;

  if (!from || !to) {
    throw new Error('ALERT_FROM_EMAIL / ALERT_TO_EMAIL are not configured.');
  }

  await transport().sendMail({ from, to, subject: input.subject, text: input.text, html: input.html });
}
