// Verifies requests to /api/internal/* — hit by Cloud Scheduler (HTTP target
// with an OIDC token) rather than by a logged-in admin. proxy.ts treats
// /api/internal as a public path (no session cookie required), so THIS check
// is the only thing standing between the internet and these endpoints. Every
// /api/internal/* route must call this before doing anything else.

import { OAuth2Client } from 'google-auth-library';

const oauthClient = new OAuth2Client();

function allowedInvokerEmails(): string[] {
  return (process.env.CLOUD_SCHEDULER_SERVICE_ACCOUNT_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export interface InternalRequestVerification {
  ok: boolean;
  reason?: string;
}

export async function verifyInternalRequest(
  authorizationHeader: string | null,
): Promise<InternalRequestVerification> {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    return { ok: false, reason: 'APP_URL is not configured — cannot verify OIDC audience.' };
  }

  const allowList = allowedInvokerEmails();
  if (allowList.length === 0) {
    // Fail closed, same principle as the admin auth allow-list in
    // lib/auth/config.ts: misconfiguration must lock everyone out, not open
    // the endpoint to the internet.
    return {
      ok: false,
      reason: 'CLOUD_SCHEDULER_SERVICE_ACCOUNT_EMAILS is not configured.',
    };
  }

  if (!authorizationHeader?.startsWith('Bearer ')) {
    return { ok: false, reason: 'Missing Bearer token.' };
  }

  const idToken = authorizationHeader.slice('Bearer '.length);

  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: appUrl });
    const payload = ticket.getPayload();

    if (!payload?.email || !payload.email_verified) {
      return { ok: false, reason: 'Token has no verified email.' };
    }

    if (!allowList.includes(payload.email.toLowerCase())) {
      return { ok: false, reason: `Service account ${payload.email} is not on the allow-list.` };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'OIDC token verification failed.',
    };
  }
}
