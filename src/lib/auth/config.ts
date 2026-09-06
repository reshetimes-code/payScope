// Auth — Google OAuth only, restricted to an explicit allow-list.
// See DECISIONS.md "Authentication" and "Exposure / network posture": this
// app-level check is one of two independent layers, the other being IAP in
// front of Cloud Run in production.

import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

function allowedAdminEmails(): string[] {
  const raw = process.env.ALLOWED_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const authConfig: NextAuthConfig = {
  // Required for any reverse-proxied deployment (Cloud Run terminates TLS
  // at its own edge and forwards over HTTP with X-Forwarded-* headers) —
  // without this Auth.js rejects every request as an "untrusted host".
  // Safe here because Cloud Run's own edge is what sets those headers, not
  // an arbitrary client.
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      // TEMPORARY probe: requesting cloud-platform here to test whether this
      // app's own OAuth client is also blocked by the org's API Controls, or
      // whether that restriction was specific to gcloud's client id. If this
      // works, the plan is to use the signed-in admin's own token instead of
      // ADC/a service account (see chat) — not yet wired into any API calls.
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          scope: 'openid email profile https://www.googleapis.com/auth/cloud-platform',
        },
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;

      const allowList = allowedAdminEmails();
      if (allowList.length === 0) {
        // Fail closed: an empty allow-list must never mean "everyone is
        // allowed". Misconfiguration should lock everyone out, not open up.
        console.error(
          'ALLOWED_ADMIN_EMAILS is not set — rejecting all sign-ins until configured.',
        );
        return false;
      }

      return allowList.includes(email);
    },
    async jwt({ token, account }) {
      // Captured only on the initial sign-in redirect (account is only
      // present that one time) — persists the Google access/refresh tokens
      // inside the encrypted session JWT so server-side API routes can use
      // the signed-in admin's own Google Cloud permissions instead of ADC.
      // See chat/DECISIONS.md: this app's own OAuth client turned out not to
      // be subject to the Workspace policy that blocks gcloud's client id.
      if (account) {
        token.googleAccessToken = account.access_token;
        token.googleRefreshToken = account.refresh_token;
        token.googleAccessTokenExpiresAt = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      session.googleAccessToken = token.googleAccessToken as string | undefined;
      session.googleRefreshToken = token.googleRefreshToken as string | undefined;
      session.googleAccessTokenExpiresAt = token.googleAccessTokenExpiresAt as number | undefined;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};
