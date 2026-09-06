import type { DefaultSession } from 'next-auth';

// Extends the session/JWT with the signed-in admin's Google OAuth tokens —
// see src/lib/auth/config.ts jwt/session callbacks and
// src/lib/providers/google/user-auth.ts for why these exist.
declare module 'next-auth' {
  interface Session extends DefaultSession {
    googleAccessToken?: string;
    googleRefreshToken?: string;
    googleAccessTokenExpiresAt?: number;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    googleAccessToken?: string;
    googleRefreshToken?: string;
    googleAccessTokenExpiresAt?: number;
  }
}
