import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { generateRenderInvoice } from '@/lib/invoices/generate-render';
import { writeAuditLog } from '@/lib/audit/log';

interface LineInput {
  name: string;
  amount: number;
}

// Owner-triggered, from /invoices/render/new — see generate-render.ts for
// why this is entered manually instead of synced (Render has no cost API).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const correlationId = randomUUID();
  const body = await req.json().catch(() => null);
  const year = Number(body?.year);
  const month = Number(body?.month);
  const lines = body?.lines as LineInput[] | undefined;

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'שנה/חודש חסרים או לא תקינים' }, { status: 400 });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: 'צריך לפחות שורה אחת עם שם וסכום' }, { status: 400 });
  }
  for (const l of lines) {
    if (!l?.name || typeof l.name !== 'string' || typeof l.amount !== 'number' || !Number.isFinite(l.amount) || l.amount < 0) {
      return NextResponse.json({ error: `שורה לא תקינה: ${JSON.stringify(l)}` }, { status: 400 });
    }
  }

  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0)); // last day of that month

  try {
    const invoice = await generateRenderInvoice({ periodStart, periodEnd, lines });
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'render.invoice.create',
      provider: 'RENDER',
      newValue: { periodStart, totalAmount: invoice.totalAmount.toString(), lineCount: lines.length },
      result: 'SUCCESS',
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ invoiceId: invoice.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'יצירת חשבונית Render נכשלה';
    await writeAuditLog({
      actorLabel: session.user.email,
      action: 'render.invoice.create',
      provider: 'RENDER',
      result: 'FAILURE',
      errorSummary: message,
      requestCorrelationId: correlationId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
