import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

// No auth check here — proxy.ts already requires an admin session for
// every route except /login, /api/auth/*, /api/internal/* (see
// PUBLIC_PATHS there), so this route is only ever reached signed-in.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: 'invoice not found' }, { status: 404 });
  }

  return new NextResponse(Buffer.from(invoice.pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.pdfFilename}"`,
    },
  });
}
