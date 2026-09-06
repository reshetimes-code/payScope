import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';

// Routes that never require an authenticated session:
//  - /login: the sign-in page itself
//  - /api/auth/*: NextAuth's own endpoints
//  - /api/internal/*: protected separately by verifying the Cloud Scheduler /
//    Pub/Sub OIDC token, not by admin session (see lib/auth/verifyInternal.ts,
//    added when the sync endpoints are implemented in Phase 1).
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/internal'];

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!isPublic && !req.auth) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
