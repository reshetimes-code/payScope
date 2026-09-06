// Uses the signed-in admin's own Google OAuth tokens (captured at login,
// scope `cloud-platform` — see src/lib/auth/config.ts) as the credential for
// Google Cloud API calls, instead of Application Default Credentials.
//
// Why: this app's dedicated OAuth client (created in Google Cloud Console
// for admin login) turned out NOT to be subject to the Workspace API
// Controls restriction that blocks `gcloud auth application-default login`
// (that restriction was specific to gcloud's own OAuth client id). See
// DECISIONS.md and README "Real-GCP validation attempt" for the full story.
//
// This only covers interactively-triggered routes (anything that can read
// the admin's session). The Cloud Scheduler-triggered internal sync route
// has no session and still needs its own solution — see README "Next steps".

import { OAuth2Client } from 'google-auth-library';
import type { Session } from 'next-auth';

export function getGoogleAuthClientFromSession(session: Session): OAuth2Client | null {
  if (!session.googleAccessToken) return null;

  const client = new OAuth2Client({
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  });

  client.setCredentials({
    access_token: session.googleAccessToken,
    refresh_token: session.googleRefreshToken,
    expiry_date: session.googleAccessTokenExpiresAt
      ? session.googleAccessTokenExpiresAt * 1000
      : undefined,
  });

  return client;
}
