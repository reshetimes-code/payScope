import { NextResponse } from 'next/server';
import { verifyInternalRequest } from '@/lib/auth/verify-internal';
import { generateOrgInvoice, previousMonthRange } from '@/lib/invoices/generate';

// Cloud Scheduler entry, monthly — generates the previous month's org-wide
// invoice summary (one row covering every billing account listed in
// GOOGLE_BILLING_ACCOUNT_IDS). Safe to re-run (upserts), which is also how
// you'd manually regenerate a month after a late BigQuery correction.
export async function POST(req: Request) {
  const verification = await verifyInternalRequest(req.headers.get('authorization'));
  if (!verification.ok) {
    console.error('Rejected /api/internal/generate-invoices request:', verification.reason);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const period = previousMonthRange();

  try {
    const result = await generateOrgInvoice(period);
    return NextResponse.json({ period, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invoice generation failed';
    console.error('Invoice generation failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
