# Contract billing (piece 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bill accepted contracts automatically — session records, 3-day cycles, holds and captures on the saved card, grace/suspension/resume, the payment-readiness gate — and apply database-configured GST/HST to Poppynz's own fees (contract fees and background checks).

**Architecture:** Pure pricing and tax resolution in `@repo/billing/pricing` (browser-safe, shared with the web for displays). Tax configuration, contract billing state, cycles, sessions, ledger and incidents in Postgres behind `TaxConfigRepo` and `ContractBillingRepo` (`@repo/db`). The billing engine (`@repo/billing`, `src/contracts/*`) is one per-contract step `runContractBilling(contractId, now)` that the worker's 15-minute tick runs for every live contract, the API runs right after acceptance and after a card replacement, and a dev-only CLI runs "as of" an instant. Provider calls go through two new port operations (`chargeSavedCard`, `capturePayment`) and every outcome lands through the existing `settlePayment`.

**Tech Stack:** as pieces 2a/2b — Bun workspaces + Turborepo, Effect 3, Hono RPC, Drizzle (hand-written SQL migrations), SvelteKit 5 (runes) + DaisyUI 5, vitest (api, worker, web), `bun test` (packages), `stripe@23.0.0` inside `@repo/payments` only.

**Spec:** `docs/superpowers/specs/2026-10-24-contract-billing-design.md` (umbrella §5, §6, §10, §11).

## Global Constraints

- Work only in `/run/media/hbt/work/poppynz/stripe-integration` (branch `feature/stripe-integration`). Never `git stash`.
- Nothing outside `packages/payments` names Stripe.
- AGENTS.md: route error types derived from programs; mappers switch on `_tag` and end with `handleNever`; repo errors piped (`repo.x().pipe((errors) => mapXError(errors))`); permissions via `requirePermissions`; soft delete with `deletedAt`; focused unit tests for every route/domain program; toasts for success/error messages.
- Integer cents; one rounding rule (`roundHalfUp`); tax lines frozen on the payment row and the cycle.
- Migrations are hand-written SQL plus a `meta/_journal.json` entry: `0027_payment_tax_lines` (when 1788180000000), `0028_tax_config` (1788190000000), `0029_contract_billing` (1788200000000). Every new FK `ON DELETE restrict`.
- Pre-existing baseline (not ours): `apps/api` 2 failing tests in `src/lib/mailer.unit.test.ts`; `bunx tsc --noEmit -p tsconfig.json --moduleResolution bundler --module ESNext --target ES2022` in `apps/api` reports 52 errors, all in test files. Compare against that.
- `apps/api/.env` carries a real Credibled key: never pay for a background check in the local stack.
- Commit after every task, conventional message, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Spec ambiguities resolved here

1. **Contract cancelled at the readiness deadline** → stored `contracts.status = 'ended'` with an explanatory `end_note` (the enum value existed for this), plus `contract_billing.status = 'cancelled'`; the detail shows why.
2. **Helper not ready at a later cycle** → the readiness gate's "no hold while not ready" applies to every cycle (umbrella §8: never keep booking sessions with no viable payment route); the cycle is suspended with reason `helper_not_ready`, the family is not asked to change their card, and it resumes on its own once the helper is ready.
3. **A Stripe/Poppynz failure before a cycle was ever funded** → never billed as a family decline; suspended at cycle start with reason `provider_unavailable`, admin alerted, auto-resume.
4. **Late booking** applies to the cycle at which the contract becomes billable (acceptance, or readiness) when that is after its `hold_at` and under 48 h before its first session.
5. **Retry cadence in grace** → every `CONTRACT_BILLING_RETRY_HOURS` (default 12), plus immediately on card replacement.
6. **Idempotency keys** → `cycle-<cycleId>-<attempt>` for holds/charges (a declined key can't be reused), `capture-<cycleId>` for the capture.
7. **Rate shown before acceptance** → the current config; after acceptance → the frozen commissions and the provinces frozen on `contract_billing`. Tax is re-resolved per cycle from the configuration in force on its first day and then frozen on that cycle.
8. **Taxable care service value** (not the default) → its tax would be added to the family's total and to the helper's share (the helper's supply).
9. **Weekly breakdown** on the detail → computed from the weekly pattern with the shared per-session rounding; billing itself sums real elapsed minutes per dated session.

## File Structure

| File | Responsibility |
|---|---|
| `packages/billing/src/pricing/rounding.ts`, `tax.ts`, `amounts.ts`, `index.ts` (+ tests) | Pure: `roundHalfUp`, `applyBps`, province normalisation, `computeSupplyTax`, labels, cycle and weekly amounts. Exported as `@repo/billing/pricing` |
| `packages/billing/src/tax.ts` (+ test) | Effect wrappers: `loadTaxSnapshot`, `quoteSupplyTax`, typed tax errors |
| `packages/billing/src/payouts.ts` | Moved from `apps/api/src/lib/payouts.ts`: readiness (`isPaymentReady`) for the API and the worker |
| `packages/billing/src/contracts/terms.ts` | `effectiveEnd` and friends (moved from the contracts handler) |
| `packages/billing/src/contracts/schedule.ts` (+ test) | Pure planning: cycles, instants, sessions for a date range |
| `packages/billing/src/contracts/engine.ts` (+ test) | `runContractBilling`, `runContractBillingTick`, `retryFamilyBilling`, `newContractBilling` |
| `packages/billing/src/contracts/settle-cycle.ts` | The contract-cycle branch of `settlePayment` |
| `packages/billing/src/contracts/notices.ts` | Notices: realtime + mail + admin alerts |
| `packages/db/src/migrations/0027…0029` + journal, `schema.ts` | Tables and enums |
| `packages/db/src/repos/tax-config-repo.ts` (+ test) | `TaxConfigRepo` (+ in-memory test repo) |
| `packages/db/src/repos/contract-billing-repo.ts` | `ContractBillingRepo` (+ in-memory test repo) |
| `packages/seeder/src/seeds/0004_tax_config.ts` | Seeded tax defaults |
| `packages/payments/src/{port,mock,stripe}.ts` (+ tests) | `chargeSavedCard`, `capturePayment`, `authorised`, `description` |
| `packages/mail/src/{mailer,templates}.ts` | `sendContractBillingNotice`, `sendAdminBillingAlert` |
| `packages/notify/src/events.ts` | `contract.billing` |
| `packages/queue/src/index.ts` | `contract-billing` queue, `tick` job, scheduler id |
| `packages/env/src/index.ts` | `contractBillingConfig` |
| `apps/api/src/routes/app/safety-verification/*` | Tax-line quote, `TAX_PROVINCE_REQUIRED` |
| `apps/api/src/routes/app/contracts/*` | Provinces at send/accept, billing row, `pricing`, `billing` |
| `apps/api/src/routes/app/billing/*`, `routes/webhooks/stripe.ts` | Retry on card replacement; capturable event |
| `apps/worker/src/contract-billing-processor.ts` (+ test), `index.ts` | The tick job |
| `apps/worker/src/dev/{guard,billing-tick,billing-fixture}.ts` (+ guard test) | Dev-only clock and fixture |
| `apps/web/src/lib/components/contracts/{PriceBreakdown,ContractBillingPanel}.svelte` (+ mount tests) | Breakdown and cycles |
| `apps/web/src/lib/components/verification/SafetyCheckPanel.svelte`, `routes/family/billing/+page.svelte` | Tax lines, contract charges |

## Tasks

### Task 1: Shared pricing and tax resolution (`@repo/billing/pricing`)
- [ ] Tests first (`packages/billing/src/pricing/*.test.ts`): `roundHalfUp` (halves up, integers only), `applyBps`, `normaliseProvince` (codes, names, case, non-CA → null), `computeSupplyTax` with the seeded snapshot for all 13 provinces, NS 15%→14% on 2025-04-01, QST only once registered, exempt/out-of-scope → no lines, unknown province → `province_required`, taxable without a rate → `rate_missing`, missing treatment → `treatment_missing`, labels (`HST (ON) 13%`, `QST (QC) 9.975%`), `cycleAmounts` ($600 example), `weeklyBreakdown`.
- [ ] Implement; add `"./pricing": "./src/pricing/index.ts"` to `packages/billing/package.json` exports.
- [ ] `cd packages/billing && bun test src` → pass. Commit `feat(billing): shared pricing, rounding and tax resolution`.

### Task 2: Tax configuration tables, repo and seeds
- [ ] `0028_tax_config.sql`: `btree_gist`, enums, the six tables, exclusion constraints, FKs restrict; schema.ts mirrors it.
- [ ] `TaxConfigRepo` (live + `makeInMemoryTaxConfigRepo`), `TaxConfigOverlapError`, `TaxConfigNotFoundError`; supersede/delete write the audit row in the same transaction.
- [ ] Seed `0004_tax_config` (registry in `seeds/index.ts`), data from spec §3a.
- [ ] Tests: in-memory repo semantics (`bun test`), and the live repo against the docker Postgres (`DATABASE_URL` set, skipped otherwise).
- [ ] Commit `feat(db): tax configuration tables, repo and seeded defaults (0028)`.

### Task 3: Tax on background-check payments
- [ ] `0027_payment_tax_lines.sql`: `payments.tax_lines jsonb not null default '[]'`, `description`, `captured_cents`; `payment_kind` + `contract_cycle`; `payments.user_id` → restrict.
- [ ] Port: `QuotePolicy` becomes `{ adminFeeCents, tax: { checks, adminFee } }` (pre-resolved lines from `@repo/billing/pricing`); `Money` gains `taxLines`; `startPayment` takes `description`.
- [ ] API: resolve the payer's province, `TaxProvinceRequiredError` → `422 TAX_PROVINCE_REQUIRED`; GET summary `quote: null` + `quoteBlockedReason`; freeze `taxLines` on the row; description into the intent. Remove `SAFETY_VERIFICATION_TAX_RATE_BASIS_POINTS`.
- [ ] Web: SafetyCheckPanel lists each tax line by label; billing history shows them.
- [ ] Tests: handler unit tests for the ON quote ($5.00 fee → $0.65 HST), unknown province, frozen lines on the payment; mock/Stripe adapter description.
- [ ] Commit `feat(api): GST/HST by province on background-check payments`.

### Task 4: Payment port — off-session holds and captures
- [ ] Tests (`mock.test.ts`, `stripe.test.ts`): manual-capture hold → `authorised`; automatic → `succeeded`; decline returned as data (fake `StripeCardError` carrying `payment_intent`); provider error fails; idempotency keys passed; `capturePayment` with `amount_to_capture`; `requires_capture` normalised to `authorised`; mock `decline` card.
- [ ] Implement `chargeSavedCard`, `capturePayment`; `ProviderPayment.capturableCents/receivedCents/captureBefore`.
- [ ] Commit `feat(payments): off-session holds, captures and immediate charges on the saved card`.

### Task 5: Contract billing tables and repo
- [ ] `0029_contract_billing.sql`: enums, `contract_billing`, `contract_cycles`, `contract_sessions`, `billing_ledger_entries`, `billing_incidents`; `contracts` user FKs → restrict.
- [ ] `ContractBillingRepo` (live + in-memory): billing row CRUD with `advanceBilling`, `listLive`, cycles (`insertCycles`, `listCycles`, `findCycleByPaymentId`, `advanceCycle`), sessions (`insertSessions`, `listSessions`, `setSessionStatus`), `appendLedger`, `recordIncident`. `ContractRepo.acceptPendingVersion` takes an optional `billing` row to insert in its transaction.
- [ ] Commit `feat(db): contract billing, cycles, sessions, ledger and incidents (0029)`.

### Task 6: Schedule planning (pure)
- [ ] Tests: 3-day cycles from the start date; `hold_at`/`capture_at`/`transfer_at` in `America/Toronto` across the November DST change; capture at first session − 1 h when earlier than 07:00; partial last cycle with a last-day end time; window clipping; slots; elapsed minutes on DST nights.
- [ ] Commit `feat(billing): plan sessions and 3-day cycles from the accepted pattern`.

### Task 7: Billing engine
- [ ] Move readiness to `packages/billing/src/payouts.ts` (API re-exports; its tests keep passing) and `effectiveEnd` to `contracts/terms.ts`.
- [ ] `newContractBilling` (frozen bps/provinces), `runContractBilling(contractId, now)`, `runContractBillingTick(now)`, `retryFamilyBilling(userId, now)`; `settlePayment` routes `contract_cycle` rows to `settle-cycle.ts`.
- [ ] Engine tests (in-memory repos + mock provider + fixed clock) for every scenario in spec §11.
- [ ] Mail templates + `contract.billing` event + notices.
- [ ] Commit in slices: `feat(billing): …` per scenario group; `feat(mail): contract billing notices and admin alerts`; `feat(notify): contract.billing event`.

### Task 8: API
- [ ] Send/accept: provinces (`TAX_PROVINCE_REQUIRED`), billing row in the acceptance transaction, billing step after acceptance.
- [ ] Detail: `pricing` per version (viewer's side), `billing` with cycles.
- [ ] Billing: card confirm → `retryFamilyBilling`; webhook `setup_intent.succeeded` likewise; `payment_intent.amount_capturable_updated` settles; history descriptions and tax lines.
- [ ] Unit tests for each program change; commit `feat(api): …`.

### Task 9: Worker and dev tools
- [ ] `contract-billing` queue + 15-minute scheduler + processor (test with a stub engine).
- [ ] `apps/worker/src/dev/guard.ts` (+ test: refuses unless `ENVIRONMENT=dev` set explicitly and `BILLING_DEV_CLOCK=enabled`; always refuses production), `billing-tick.ts`, `billing-fixture.ts`.
- [ ] Commit `feat(worker): contract billing tick`, `test(worker): dev-only billing clock and fixture`.

### Task 10: Web
- [ ] `PriceBreakdown.svelte` in the editor (live, shared pricing) and terms view (server `pricing`); `ContractBillingPanel.svelte` on the detail; billing page lists contract charges; toasts for errors (`TAX_PROVINCE_REQUIRED` etc.).
- [ ] Mount tests; `bun run check`; commit `feat(web): …`.

### Task 11: Verification
- [ ] `bun test src` in packages billing, payments, calendar, db, seeder; `bunx vitest run` in api, worker, web; `bun run check-types`; the api tsc command above (≤ 52 errors, none new); `bun run lint` on touched packages.
- [ ] `docker compose up migrations seeds` → 0027–0029 applied, tax seed applied.
- [ ] `git merge-tree --write-tree develop HEAD` → no conflicts.

## Local end-to-end (Stripe test mode)

Prerequisites: `apps/api/.env` has `PAYMENTS_PROVIDER=stripe` and test keys; `apps/web/.env` the publishable key; Stripe CLI at `~/.bun/bin/stripe`.

1. Stack: `docker compose up -d postgres redis typesense rustfs && docker compose up migrations seeds && docker compose up -d api worker`; web: `cd apps/web && bun run dev -- --port 5173`.
2. Webhooks: `stripe listen --forward-to localhost:3000/webhooks/stripe --forward-connect-to localhost:3000/webhooks/stripe`; put the printed `whsec_…` in `apps/api/.env` as `STRIPE_WEBHOOK_SECRET` and restart `api`.
3. Payout-ready helper account: `bun --env-file=apps/api/.env packages/payments/scripts/e2e-payout-account.ts create-ready` → `acct_…`.
4. Fixture: `ENVIRONMENT=dev BILLING_DEV_CLOCK=enabled bun --env-file=apps/api/.env apps/worker/src/dev/billing-fixture.ts --payout-account acct_…` → prints the two test logins (magic link; the link is printed by `docker logs api`).
5. Family: sign in, Billing → Add a card → `4242 4242 4242 4242` (or `4000 0000 0000 0341` for the decline path: it saves, then every charge is declined); Contracts → the helper → terms with a start date 4+ days out → Send. The family sees service + 5% fee + HST (ON) 13%.
6. Helper: sign in, open the proposal (commission 15% + GST (MB) 5% deducted) → Accept & sign. Detail shows Billing "Scheduled" with cycles.
7. Advance the clock: `ENVIRONMENT=dev BILLING_DEV_CLOCK=enabled bun --env-file=apps/api/.env apps/worker/src/dev/billing-tick.ts --as-of <cycle 1 hold_at>` → cycle 1 "On hold" (Stripe dashboard: uncaptured PaymentIntent); `--as-of <capture_at>` → "Paid".
8. Decline path: with the 0341 card, `--as-of <hold_at>` → "Payment failed — retrying" (grace; family emailed); Billing → Replace card with 4242 → the hold is retried at once. Without replacing: `--as-of <starts_at>` → contract "Suspended"; replace the card → the prorated rest is charged and the contract resumes.
