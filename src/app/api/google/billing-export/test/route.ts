import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { testBillingExport } from '@/lib/providers/google/bigquery';
import { getBillingExportConfigFor } from '@/lib/providers/google/config';
import { getGoogleAuthClientFromSession } from '@/lib/providers/google/user-auth';

// Setup wizard step 4 (spec §17, §5.3).
const bodySchema = z.object({ billingAccountId: z.string().min(1) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'billingAccountId is required' }, { status: 400 });
  }

  try {
    const config = getBillingExportConfigFor(parsed.data.billingAccountId);
    const authClient = getGoogleAuthClientFromSession(session) ?? undefined;
    const result = await testBillingExport(config, parsed.data.billingAccountId, authClient);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Billing export test failed' },
      { status: 400 },
    );
  }
}
