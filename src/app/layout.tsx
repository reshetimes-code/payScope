import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';
import { Logo } from '@/components/logo';
import { NavLinks } from '@/components/nav-links';
import './globals.css';

// UI language default Hebrew, RTL-first (spec §3, §23). English localization
// readiness is left for when there is more than one string table to swap.
export const metadata: Metadata = {
  title: 'PAY SCOPE',
  description: 'ניטור והגבלת הוצאות ענן ו-AI — פנימי, לא ציבורי.',
};

// Tints the mobile browser chrome (status bar / address bar) to match the
// dark page instead of leaving it white — part of "must look excellent on
// phone" per the owner's request.
export const viewport: Viewport = {
  themeColor: '#100d0b',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen bg-[#100d0b] text-stone-100 antialiased">
        {session?.user && (
          <header className="sticky top-0 z-10 border-b border-stone-800 bg-stone-950/90 shadow-[0_1px_0_0_rgba(168,85,247,0.15)] backdrop-blur">
            <div className="relative flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3 text-sm text-stone-400">
                <span className="hidden sm:inline">{session.user.email}</span>
                <form
                  action={async () => {
                    'use server';
                    await signOut({ redirectTo: '/login' });
                  }}
                >
                  <button
                    type="submit"
                    className="rounded-md border border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-300 transition-colors hover:border-purple-500/50 hover:text-purple-400"
                  >
                    התנתק
                  </button>
                </form>
              </div>
              <Link href="/dashboard" className="absolute left-1/2 -translate-x-1/2">
                <Logo />
              </Link>
            </div>
            <NavLinks />
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
