# Decisions log — Cost Control Center

Living document. Append new decisions with a date; do not silently overwrite past
reasoning — cross out and add a new entry if a decision changes.

## 2026-08-09 — Initial scope decisions

### Tenancy
**Decision:** Build single-tenant (owner only) for v1. Do not add multi-tenant
data isolation, per-customer credential storage, or a billing-for-customers
system now.
**Why:** The owner raised the possibility of eventually selling this to other
people in the space. Multi-tenancy changes the data model (`tenant_id` on every
table), the trust/legal posture (holding other businesses' GCP/OpenAI/Anthropic
admin credentials), and requires a subscription-billing system of its own. That
is a distinct product decision that deserves to be made deliberately once a
single-tenant version is proven on the owner's real projects — not bolted on
as a side effect of this build.
**How to apply:** Keep the provider-adapter architecture (spec §9) clean and
capability-driven — it is the part of this design that *would* make a future
multi-tenant retrofit tractable. Do not hardcode single-user assumptions inside
adapters; only the auth/session layer and DB schema are single-tenant for now.

### Authentication
**Decision:** Google OAuth login only, restricted to an explicit allow-list of
the owner's email address(es) via `ALLOWED_ADMIN_EMAILS`. No separate
email+password/TOTP flow for v1.
**Why:** Fewer credentials to manage, MFA already enforced by the owner's
Google account, faster to build correctly than a bespoke TOTP flow.

### Exposure / network posture
**Decision:** Cloud Run app sits behind Identity-Aware Proxy (IAP) *in addition
to* the app's own Google OAuth login. Defense in depth, not either/or.
**Why:** This app can view billing/cost data across every connected provider
and — per spec §34 — can execute Hard Stop actions that take production sites
offline. A login bug or leaked session cookie here is a materially worse
outcome than on a normal marketing site. Two independent layers (network-level
IAP + app-level OAuth) means one bug doesn't equal full compromise.

### Hard Stop default action per provider
**Decision:**
- **Google Cloud Run–hosted site with a dedicated project:** default Hard Stop
  action is `AUTOMATED_SERVICE_SHUTDOWN` implemented as setting the specific
  Cloud Run service's `max-instances` to `0` (scoped, reversible, doesn't touch
  other resources in the project).
- **Google project shared by multiple sites:** do NOT auto-execute
  `BILLING_DISCONNECT` (project-wide) automatically. Capability reports
  `MANUAL_ACTION_REQUIRED` and the dashboard prompts the owner instead of
  silently killing unrelated sites.
- **OpenAI / Anthropic:** `API_KEY_DISABLE_OR_ROTATION` is the only generally
  available stop mechanism. Document explicitly in the UI that resuming after
  a stop on these providers requires issuing a new key and redeploying it to
  the affected app — this is not a pure dashboard toggle like the GCP case.
**Why:** Spec §34.3 already requires scoping stop actions as narrowly as
possible and warns before affecting shared resources — this decision makes
that concrete instead of leaving "safest supported action" undefined per
provider.

### GCP credential strategy
**Decision:** Prefer the Cloud Run service's attached service account
(workload identity) granted org/billing-level IAM roles directly, over
generating and storing a downloadable JSON key for the monitoring service
account.
**Why:** Spec §28 already states this preference for anything deployed on
Google Cloud; making it the default (not just a "prefer if possible" aside)
removes an unnecessary long-lived secret from the credential store entirely
for the Google connector specifically. OpenAI/Anthropic admin keys still need
encrypted-at-rest storage since there's no equivalent workload identity for
those providers.

### ops-monitor (uptime / cron-health tool)
**Decision:** Shelved. Not part of this project.
**Why:** Different problem domain (site-up / cron-ran-or-not) than billing
protection. Not a dependency of Cost Control Center. Revisit only if silent
site outages become a real pain point, as its own small, separate tool.

### Outstanding — not yet decided
- DB host for production: spec allows Supabase Postgres or Cloud SQL. Defaulting
  to **Supabase Postgres** for v1 (simpler ops, no need to babysit Cloud SQL) per
  development rule §30.16 (pick an obvious default, document it, keep moving).
  Revisit if data residency or VPC-only access becomes a requirement.
- Exact IAM role list for the monitoring service account — to be finalized when
  the setup wizard's "generate IAM instructions" step is implemented, against
  current official docs (spec §32), not from memory.
