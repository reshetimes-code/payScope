# Cost Control Center

Private, single-tenant dashboard for seeing and budget-limiting spend across
Google Cloud (+ Gemini), OpenAI API, and Anthropic API. **Read + limit only —
this system never touches payment processing, credit cards, or bank details.**
It mirrors what each provider already reports and, only when you explicitly
enable it, executes a provider-side action (e.g. scaling a Cloud Run service
to zero) to stop further usage once a budget you set is reached.

Full product spec: [COST_CONTROL_CENTER_SPEC.md](./COST_CONTROL_CENTER_SPEC.md)
(+ [COST_CONTROL_CENTER_SPEC_MORE.md](./COST_CONTROL_CENTER_SPEC_MORE.md) for
the Hard Stop addendum). Decisions made that aren't in the spec itself — auth
method, exposure model, tenancy scope, per-provider stop-action defaults —
are in [DECISIONS.md](./DECISIONS.md). Read that before changing security- or
enforcement-related code; it explains *why*, not just *what*.

## Status

Google Cloud connector (Phase 1 core) is implemented and builds/type-checks
cleanly end-to-end. Local Postgres + migration have been run for real (see
below); the Google API calls themselves have not — see "Real-GCP validation
attempt" below for why, before spending more time on this yourself.

### Real-GCP validation attempt (2026-08-10)

Tried to validate the Google connector against the real `reshetimes-org` org.
Blocked by two org-level security policies, not by anything in this codebase:

1. `gcloud auth application-default login` (personal-account ADC) fails with
   `cloud-platform scope is required but not consented`, consistently, across
   multiple clean attempts — looks like a Google Workspace API Controls
   restriction on that scope for this domain, not a one-off consent mistake.
2. Downloading a service-account key fails with
   `constraints/iam.disableServiceAccountKeyCreation` (org policy). A
   dedicated SA (`cost-control-center-dev@silver-503012.iam.gserviceaccount.com`)
   was created for this and still exists, unused, no key — safe to delete or
   keep for whenever this is revisited.
3. Overriding that org policy at the project level also failed —
   `reshetimes@gmail.com` has Owner on individual projects but not
   `orgpolicy.policyAdmin`.

Neither is fixable from code. Next attempt should either use a non-Workspace
personal Google account (no org policy applies) or get a Workspace admin to
allow the `cloud-platform` scope for "Google Cloud SDK" in Admin Console →
Security → API Controls.

- ✅ Next.js App Router project structure, TypeScript strict mode, Tailwind
- ✅ Prisma schema for the full data model (spec §10 + Hard Stop tables),
  including a natural-key upsert for `CostRecord` so late billing-export
  corrections update the existing row instead of duplicating it
- ✅ Provider adapter interface (`src/lib/providers/types.ts`) and
  remediation interface (`src/lib/remediation/types.ts`) — capability-driven,
  per spec §9 and §21
- ✅ Google Cloud connector (`src/lib/providers/google/`): Resource Manager
  project discovery, Cloud Billing account/project associations, BigQuery
  billing export reader (standard + detailed, gross/credits/net), Budget API
  (create/update project-scoped budgets), all wired to Prisma via `sync.ts`
- ✅ API routes: `/api/google/discover`, `/api/google/billing-accounts`,
  `/api/google/projects`, `/api/google/billing-export/test`,
  `/api/google/budgets`; `/api/internal/sync/google` for the Cloud Scheduler
  job, gated by OIDC verification (`src/lib/auth/verify-internal.ts`) since
  it's outside normal session auth
- ✅ Audit logging (`src/lib/audit/log.ts`) wired into discovery + budget writes
- ✅ Google Cloud Run scoped stop/resume implementation
  (`src/lib/remediation/google.ts`) — fails closed to `MANUAL_ACTION_REQUIRED`
  until project-sharing detection is wired to real data
- ✅ Auth: Google OAuth + email allow-list (`src/lib/auth`), route protection
  via `src/proxy.ts` (Next.js 16's replacement for `middleware.ts`)
- ✅ `/providers/google` (connect + discover + billing-export test, functional
  but not yet the full guided wizard) and `/google/projects` (real data table)
- ✅ Project→site mapping: `/apps` (create site, see unmapped-project count)
  and `/apps/[id]` (map a discovered project — FULL mode backfills existing
  `cost_records` immediately, spec §12 acceptance test; PERCENTAGE mode is
  always labeled "משוער"/estimated, never exact, per spec §2)
- ✅ Budget threshold evaluation + email alerts
  (`src/lib/alerts/evaluate-budgets.ts`): MTD run-rate forecast, anti-spam via
  `BudgetThreshold.triggerCycleKey` (spec §14 — one alert per threshold per
  monthly cycle), writes `Alert` + `BudgetEvent` rows, wired into
  `/api/internal/sync/google` after every cost sync plus a standalone
  `/api/internal/evaluate-budgets` for an independent daily-digest cadence
- ✅ `isProjectSharedAcrossApps` in `src/lib/remediation/google.ts` now reads
  real `AppResourceMapping` data (exactly one mapped app = dedicated =
  eligible for scoped auto-stop; zero or many = fails closed)
- ✅ `/budgets` (spec §13) — single cross-provider table (spend, %, forecast,
  enforcement mode), inline "set a new budget" form, and a Hard Stop
  toggle per budget. Protection-status column (spec §34.10) reflects the
  real `hardStopEnabled` state — 🟢 only when actually enabled, 🟡 otherwise
- ✅ Hard Stop execution (`src/lib/alerts/execute-hard-stops.ts`, spec §34):
  wired into `/api/internal/sync/google` after every alert pass. Enabling
  requires typing the exact GCP project id back (`/api/budgets/:id/hard-stop`,
  spec §34.11) — never a single click. A dedicated Cloud Run target
  (region + service name) must be set per app first
  (`/api/apps/:id/hard-stop-target`, `/apps/[id]` UI) since there's no way
  to derive which deployed service to stop from billing-export data alone.
  Every stop/fail writes a `BudgetEvent` with `preActionStateJson` and sends
  an email (spec §34.5, §34.6)
- ✅ Shared MTD forecast math (`src/lib/forecast/mtd.ts`) used by both the
  alert job and `/budgets`, so the number is computed exactly one way
- ✅ All other pages from spec §23 exist as routes (placeholder content)
- ⬜ Not yet run against a real GCP project — no live Postgres in this
  environment to migrate against (see "Next steps")
- ⬜ Guided multi-step setup wizard UI (spec §17) — `/providers/google` covers
  the functionality, not the step-by-step chrome
- ⬜ Threshold evaluation never executes a Hard Stop, even when
  `actionType: TRIGGER_HARD_STOP`/`hardStopEnabled: true` — it only alerts.
  Wiring evaluation → `lib/remediation` execution is a deliberate next step,
  kept separate so alerting can be verified working before anything
  destructive is automated
- ⬜ OpenAI / Anthropic connectors (Phase 2)

## Local development

Requires Node 20+, Docker (for local Postgres).

```bash
cp .env.example .env.local
# fill in DATABASE_URL (see docker-compose below), AUTH_SECRET, ALLOWED_ADMIN_EMAILS,
# GOOGLE_OAUTH_CLIENT_ID/SECRET at minimum to run the app shell.

docker compose up -d          # starts local Postgres
npm install
npm run prisma:migrate        # creates tables from prisma/schema.prisma
npm run dev
```

`DATABASE_URL` for the local Postgres container (port 5435, not the default
5432 — see docker-compose.yml, another local project already holds 5432 on
this machine):
```
postgresql://cost_control:cost_control_local_dev@localhost:5435/cost_control_center
```

## Next steps (Phase 1 — Google Cloud, per spec §25/§33)

1. Get real GCP credentials working — blocked, see "Real-GCP validation
   attempt" above. Needs either a non-Workspace Google account or a Workspace
   admin to allow the `cloud-platform` OAuth scope. Local Postgres + `.env.local`
   are already set up and waiting (`docker compose up -d` then `npm run dev`
   is all that's left once auth is unblocked).
2. Once unblocked: click through `/providers/google` → `/google/projects` →
   `/apps` (map a project) → `/budgets` (set a budget) →
   `/api/internal/sync/google` (trigger a sync + alert pass by hand — needs
   `CLOUD_SCHEDULER_SERVICE_ACCOUNT_EMAILS`/OIDC, see
   `src/lib/auth/verify-internal.ts`, or temporarily relax it for a manual
   local test).
3. Configure SMTP (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`,
   `ALERT_FROM_EMAIL`/`ALERT_TO_EMAIL`) and confirm a threshold email actually
   arrives — `src/lib/notify/email.ts` throws loudly if unconfigured, but
   that's only been exercised by reading the code, not sending mail.
4. Guided setup wizard UI (spec §17) around the existing
   `/providers/google` functionality.
5. Resume workflow is now wired (`/api/budgets/:id/resume`, `src/lib/alerts/resume-hard-stop.ts`)
   — `/budgets` shows 🔴 suspended state with a "הפעל מחדש" button, blocked
   until spend is back under the hard limit if
   `manualResumeRequiresBudgetIncrease` is set. `/dashboard` is now wired to
   real data (spec §11 summary cards, currency-grouped per spec §18 — no FX
   conversion is invented). Still missing: a dedicated suspended-site banner
   on `/dashboard` itself (spec §34.4) and auto-resume at the start of a new
   billing cycle (spec §34.8).
6. Cloud Scheduler jobs pointing at `/api/internal/sync/google` (every 3h,
   spec §16) and `/api/internal/evaluate-budgets` (daily) with an OIDC
   token — see `src/lib/auth/verify-internal.ts` for the exact env vars
   (`APP_URL`, `CLOUD_SCHEDULER_SERVICE_ACCOUNT_EMAILS`) it checks.

Do not build Phase 2/3 features (OpenAI/Anthropic connectors, anomaly
detection beyond the simple rule-based version, other provider adapters)
before Phase 1 is fully working end-to-end — per spec §25.

## Conventions worth knowing before adding pages

- Any Server Component page that reads from Prisma must export
  `export const dynamic = 'force-dynamic';` (see `src/app/google/projects/page.tsx`).
  Without it, Next.js statically prerenders the page at build time and every
  viewer gets whatever numbers happened to be in the DB during `next build` —
  frozen forever, not just "a bit stale". Caught by `next build` failing when
  no `DATABASE_URL` is set at build time; don't silence that by adding a
  fallback DB — add the directive instead.

## Security notes (see DECISIONS.md for full reasoning)

- Production exposure: Cloud Run behind IAP, in addition to the app's own
  Google OAuth login — two independent layers, not one.
- GCP credentials: prefer the Cloud Run service's attached service account
  (workload identity) over a downloadable JSON key wherever the org's IAM
  setup allows it.
- Never commit `.env`/`.env.local` or any `*service-account*.json` — see
  `.gitignore`.
