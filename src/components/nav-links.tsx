'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const NAV_LINKS = [
  { href: '/dashboard', label: 'לוח בקרה' },
  { href: '/history', label: 'היסטוריה' },
  { href: '/google/projects', label: 'פרויקטי Google' },
  { href: '/apps', label: 'אתרים' },
  { href: '/budgets', label: 'תקציבים' },
  { href: '/alerts', label: 'התראות' },
  { href: '/providers/google', label: 'חיבור Google' },
  { href: '/providers/render', label: 'חיבור Render' },
  { href: '/audit', label: 'יומן ביקורת' },
  { href: '/settings', label: 'הגדרות' },
  { href: '/invoices', label: 'חשבוניות' },
];

function isActive(pathname: string | null, href: string) {
  return pathname === href || (pathname?.startsWith(`${href}/`) ?? false);
}

export function NavLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu automatically whenever navigation happens, so it
  // never stays open covering the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Desktop / tablet — plain horizontal bar, unchanged. */}
      <nav className="hidden overflow-x-auto border-t border-stone-800 px-4 py-1.5 text-sm sm:flex sm:gap-1">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={
              isActive(pathname, link.href)
                ? 'whitespace-nowrap rounded-md bg-purple-500/10 px-3 py-1.5 font-medium text-purple-400'
                : 'whitespace-nowrap rounded-md px-3 py-1.5 text-stone-400 hover:bg-stone-800/60 hover:text-stone-100'
            }
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {/* Phone — hamburger toggle + slide-down panel. */}
      <div className="border-t border-stone-800 sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="תפריט"
          className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-stone-300"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            {open ? (
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            ) : (
              <path d="M2.5 5h13M2.5 9h13M2.5 13h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            )}
          </svg>
          תפריט
        </button>
        {open && (
          <nav className="flex flex-col gap-0.5 border-t border-stone-800 bg-stone-950/60 px-2 pb-2 pt-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  isActive(pathname, link.href)
                    ? 'rounded-md bg-purple-500/10 px-3 py-2.5 font-medium text-purple-400'
                    : 'rounded-md px-3 py-2.5 text-stone-300 hover:bg-stone-800/60'
                }
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </>
  );
}
