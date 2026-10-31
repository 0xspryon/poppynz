# Staging UAT

How the staging deployment (dokploy, `compose.dokploy.yml`) is made ready for
user-acceptance testing: ready-made test accounts, Stripe in test mode, and an
admin **Billing clock** that fast-forwards one contract's billing so a tester
can see hold → capture → transfer in minutes instead of days.

Staging is hosted at **https://app.staging.poppynz.com**.

Nothing here can run in production: every switch below needs `ENVIRONMENT`
set explicitly to `staging` (or `dev` locally) and is refused for
`production` or an unset `ENVIRONMENT`. The billing clock additionally
refuses anything but a Stripe **test** secret key (`sk_test_…`).

## 1. The dokploy environment (staging)

Set these in the dokploy env of the staging deployment (they reach every
service through `env_file: .env`). The values that are not UAT-specific are
documented in the header of `compose.dokploy.yml` and in
`apps/api/.env.example`.

| Variable | Staging value | Why |
| --- | --- | --- |
| `DEPLOY_NAME` | `poppynz-staging` | compose project + Traefik router prefix |
| `APP_HOST` | `app.staging.poppynz.com` | public host of web + api |
| `ENVIRONMENT` | `staging` | explicit — required by every UAT switch; mail goes to everyone |
| `ORIGIN`, `TRUSTED_ORIGINS`, `BETTER_AUTH_URL` | `https://app.staging.poppynz.com` | CSRF, magic-link callbacks |
| `APP_WEB_ORIGIN` | `https://app.staging.poppynz.com` | where Stripe's hosted payout onboarding returns |
| `PAYMENTS_PROVIDER` | `stripe` | real Stripe calls (test mode) |
| `STRIPE_SECRET_KEY` | `sk_test_…` | the platform's **test** secret key |
| `PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` | the card form in the web app |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | signing secret of the *platform* endpoint (below) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_…` | signing secret of the *Connect* endpoint (below) |
| `UAT_FIXTURES` | `enabled` | create/reuse the UAT accounts on every deploy |
| `UAT_EMAIL_BASE` | e.g. `kay@poppynz.com` | the accounts' plus-addresses (see §2) |
| `UAT_HELPER_PAYOUT_ACCOUNT` | `acct_1UVYVL25pUls3rNB` | Hana's Stripe **test** connected account |
| `BILLING_TIME_TRAVEL` | `enabled` | Admin › Billing clock (see §4) |
| `BILLING_TIME_TRAVEL_MAX_DAYS` | `60` (default) | how far ahead an admin may run billing |

### Stripe webhooks

In the Stripe dashboard, **test mode**, add two endpoints, both pointing at

    https://app.staging.poppynz.com/webhooks/stripe

1. **Your account** (platform) events — signing secret → `STRIPE_WEBHOOK_SECRET`:
   `payment_intent.succeeded`, `payment_intent.amount_capturable_updated`,
   `payment_intent.processing`, `payment_intent.payment_failed`,
   `payment_intent.canceled`, `setup_intent.succeeded`, `charge.refunded`,
   `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.updated`,
   `charge.dispute.closed`, `charge.dispute.funds_withdrawn`,
   `charge.dispute.funds_reinstated`, `transfer.reversed`.
2. **Connected accounts** (Connect) events — signing secret →
   `STRIPE_CONNECT_WEBHOOK_SECRET`: `account.updated`, `payout.paid`,
   `payout.failed`.

See also `docs/activating-stripe-connect.md`.

## 2. The UAT accounts

With `UAT_FIXTURES=enabled`, the seeds job (`scripts/run-seeds.sh`) runs
`bun --filter @repo/seeder uat:fixtures` after the tracked seeds, in UTC.
It is **not** a tracked seed: it runs on every deploy and is idempotent
(users are matched by email and everything else reused), so the accounts come
back after a data reset and follow a changed `UAT_EMAIL_BASE`.

| Who | Address with `UAT_EMAIL_BASE=kay@poppynz.com` | Without a base |
| --- | --- | --- |
| Fiona, family, Toronto ON | `kay+fiona@poppynz.com` | `billing-family@example.test` |
| Hana, helper, Winnipeg MB, Childcare $25/h | `kay+hana@poppynz.com` | `billing-helper@example.test` |
| Robin, helper, Childcare $30/h, no conversation | `kay+robin@poppynz.com` | `replacement-helper@example.test` |
| Theo, helper, Tutoring only | `kay+theo@poppynz.com` | `replacement-tutor@example.test` |
| Paula, helper, Pet Minding + pending custom Childcare | `kay+paula@poppynz.com` | `replacement-pending@example.test` |
| The accountant | `kay+accountant@poppynz.com` | `accountant@example.test` |

Each family/helper has a profile, a live approval, a verified safety
verification (an uploaded document — nothing is ordered from Credibled),
acceptance of every published T&C (service agreement v2 included), their
services and needs, and Fiona has active conversations with Hana, Theo and
Paula. With `UAT_HELPER_PAYOUT_ACCOUNT` Hana's payout account is linked (in
`onboarding`, refreshed from Stripe on first use), so contracts with her can
be billed and paid out.

Sign in with a magic link: on staging it is mailed for real, so every
plus-address lands in the base mailbox. The worker starts after the seeds and
rebuilds the search index on boot, so the helpers appear in Find help.

Fiona has no card: add one on her **Billing** page with a Stripe test card
(`4242 4242 4242 4242`, any future expiry, any CVC).

## 3. Resetting staging data

Database, search and file data live in the deployment's Docker volumes. To
start again from scratch:

1. Stop the deployment in dokploy.
2. Delete the deployment's volumes (dokploy › the compose › Volumes, or
   `docker volume ls | grep poppynz-staging` then `docker volume rm …` on the
   host). This deletes **all** staging data.
3. Redeploy: migrations, the tracked seeds and the UAT accounts run again.

Stripe test-mode objects (customers, payment intents, transfers) are not
deleted with the database; clear them from the Stripe dashboard (Developers ›
"Delete all test data") if needed — this also deletes the test connected
account, so create a new one and update `UAT_HELPER_PAYOUT_ACCOUNT`.

To only re-create the accounts (for example after changing
`UAT_EMAIL_BASE`), redeploy: the step is idempotent.

## 4. Fast-forwarding a contract's billing (admins)

With `BILLING_TIME_TRAVEL=enabled` (and a `sk_test_` key), admins see
**Admin › Billing clock**. It lists every live contract with its family,
helper, billing status and next billing event, and the latest runs.

Open a contract to see its cycles and every upcoming event: a cycle's card
hold, capture, transfer to the helper, retries after a decline, the suspension
deadline, session-report and day-off deadlines, extra-session charges and card
dispute reminders. Each event has **Run up to here**:

- billing for **this contract only** runs exactly as the worker's 15-minute
  tick would, as if it were that event's time (other contracts never move);
- Stripe test-mode calls (holds, captures, transfers) are made now, for real;
- nothing can be undone — the contract's cycles stay where the run left them.

Event times are shown in the contract's time zone. Running up to an event
also runs everything due before it (running straight to **capture** also
places the hold). Only events the tick can act on are listed: while the
helper's payouts are not set up, no card hold is offered — the only event is
the contract's cancellation at the first cycle's capture time if the helper
still cannot be paid; once Hana's payout account is ready the holds appear.
A suspended contract's cycles show as "starts while suspended (no charge)".

Things to keep in mind while testing:

- The real clock keeps going. The worker's own tick still runs every 15
  minutes at the real time; it simply finds the fast-forwarded cycles already
  done (every step is safe twice). Sessions up to the chosen instant are
  marked completed, although they are in the future.
- A Stripe card hold expires about 7 days after it is placed. Fast-forward a
  cycle's hold and its capture in the same sitting; a hold left for its real
  capture time weeks later will have expired (the cycle then becomes
  "capture failed" and the admins are alerted).
- If the API restarts mid-run, the run stays "Running" and blocks that
  contract for 15 minutes; the next run after that marks it failed
  ("abandoned").

The instant must be after the real time and at most
`BILLING_TIME_TRAVEL_MAX_DAYS` ahead; only one run per contract at a time.
Every run is audited (`billing_clock_runs`: who, which contract, which
instant and event, billing status before and after, outcome).

A typical pass: Fiona and Hana sign a contract → **Cycle 1: card hold**
(the hold appears in Stripe) → **Cycle 1: capture** (charged) →
**Cycle 1: transfer to the helper** (a transfer to Hana's connected account).

The permission is `billingClock: ['advance']` (admins only). When the switch
is off the routes are not mounted (404) and the menu entry is hidden.

Locally, `docker compose up` with `ENVIRONMENT=dev`, `UAT_FIXTURES=enabled`
and `BILLING_TIME_TRAVEL=enabled` in `apps/api/.env` gives the same setup;
the command-line dev clock (`apps/worker/src/dev/billing-tick.ts --as-of …
--contract …`) runs the same tick steps.
