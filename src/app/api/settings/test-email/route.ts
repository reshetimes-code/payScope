import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { sendAlertEmail } from '@/lib/notify/email';

// Manual verification for the SMTP config shown on /settings — never
// exposes the credentials themselves, only whether a send succeeds.
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    await sendAlertEmail({
      subject: '[PAY SCOPE] מייל בדיקה',
      text: 'זהו מייל בדיקה מ-PAY SCOPE — אם הגיע, ה-SMTP מוגדר נכון.',
      html: '<p>זהו מייל בדיקה מ-PAY SCOPE — אם הגיע, ה-SMTP מוגדר נכון.</p>',
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'שליחת המייל נכשלה' },
      { status: 500 },
    );
  }
}
