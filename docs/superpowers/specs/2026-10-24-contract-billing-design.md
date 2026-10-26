# Contract billing: design (piece 3)

Status: **approved 2026-10-24** (founder decisions in the umbrella spec; the
GST/HST decision of 2026-10-24 is recorded there in §6 "Tax" and §12). Piece 3
of the [Stripe contract-billing umbrella design](2026-09-24-stripe-contract-billing-design.md)
(§5 Session records, §6 Contract billing, §10, §11). Builds on
[piece 2a](2026-10-02-stripe-payments-design.md) (port, settle path, webhook,
card on file) and [piece 2b](2026-10-02-stripe-connect-payouts-design.md)
(payout accounts, `isPaymentReady`).

## Goal

Once a contract is accepted, Poppynz bills it by itself: dated session records
are materialised from the weekly pattern and grouped into 3-day cycles; each
cycle is held on the family's saved card `CONTRACT_HOLD_LEAD_HOURS` (default 24) ahead and captured before care
starts. Declines get a grace period, then suspension, then resume. A contract
whose helper is not payment-ready is held back and cancelled at the cycle-1
capture deadline. GST/HST is applied by province to Poppynz's own fees (the
family service fee, the helper commission and the background-check
administration fee and the checks themselves), per the tax configuration
in the database.

Out of scope: transfers to helpers (piece 4 — `transfer_at` and the helper's
share are computed and stored, nothing is transferred), cancellations,
schedule changes, disputes, credits and refunds (piece 5).

## Decisions

1. **One `contract_billing` row per accepted contract**, inserted in the same
   transaction as the acceptance. It freezes the commissions
   (`CONTRACT_FAMILY_COMMISSION_BPS`, default 500; `CONTRACT_PROVIDER_COMMISSION_BPS`,
   default 1500) and the two places of supply (family province, helper
   province). Its `status` is the contract's billing state:
   `awaiting_payment_readiness → scheduled → active ⇄ suspended`, terminal
   `cancelled` / `ended`.
2. **The worker's 15-minute tick drives everything** (queue `contract-billing`,
   job `tick`). It is safe to run late, twice, or concurrently: every state
   change is a compare-and-set (`advance…`, `null` on a lost race) and every
   provider call carries an idempotency key derived from the cycle id.
3. **Each provider attempt is a `payments` row** of kind `contract_cycle`. The
   cycle points at its current attempt (`contract_cycles.payment_id`), keeping
   the schema rule "the subject points at payments". Holds, captures and
   immediate charges all settle through the one `settlePayment` path that the
   webhook, the browser confirm and the recovery job already use.
4. **Tax configuration is database state** (§3a): effective-dated rates,
   supply-type treatments and Poppynz's registrations, seeded with defaults
   and audited, resolved at quote time and frozen per line on the payment and
   the cycle. A missing province or a missing rate is a typed error, never a
   silent 0.
5. **One rounding rule**, `roundHalfUp(numerator / denominator)` on integers,
   shared by holds, captures, the ledger, the check-payment quote and the web
   displays.

## 1. Session records (umbrella §5)

`contract_sessions`, one row per `(contract_id, date, slot)` (unique). `slot`
is `<serviceId>@<startMinutes>` — there are no overnight sessions, and one
service can't start twice at the same minute on one day.

| Column | Meaning |
|---|---|
| `date` | Calendar date in the contract zone |
| `service_id`, `start_minutes`, `end_minutes` | Wall clock; `end_minutes` already cut at the last-day end time |
| `starts_at`, `ends_at` | UTC instants (DST applied once, at creation) |
| `elapsed_minutes` | Real elapsed minutes (`sessionElapsedMinutes`) |
| `rate_cents`, `value_cents` | Agreed rate and `roundHalfUp(rate × minutes / 60)` |
| `status` | `scheduled → completed \| cancelled \| disputed`, plus `suspended` |
| `cycle_id` | The cycle it is billed in |

- **Rolling 14-day window**: each tick materialises dates from the day after
  `contract_billing.materialised_through` (or from the start date) up to
  `today + 13` in the contract zone, never past the effective end.
  `INSERT … ON CONFLICT DO NOTHING`, so a rerun never duplicates.
- Sessions on the effective end date are cut at its end time; one starting at
  or after it is not created.
- When notice is given after sessions exist, scheduled sessions dated after
  the new effective end become `cancelled` (never deleted).
- A `scheduled` session in a captured cycle becomes `completed` once its
  `ends_at` has passed. `disputed` belongs to piece 5.

## 2. Cycles (umbrella §6 "Cycles")

`contract_cycles`, unique `(contract_id, index)`. Cycle `k` (0-based) covers
`start + 3k … start + 3k + 2`, cut at the effective end (partial last cycle).
Created by the same tick, before their sessions (which reference them).

Instants, computed once from the contract zone and stored in UTC:

- `starts_at` = 00:00 on the cycle's first day;
- `hold_at` = `starts_at` − `CONTRACT_HOLD_LEAD_HOURS` real hours (default 24;
  was 00:00 two calendar days before — umbrella §6, 2026-10-26);
- `capture_at` = min(07:00 on the first day, first session start − 1 h), or
  07:00 when the cycle has no session;
- `transfer_at` = 00:00 after the last day, + 48 h (for piece 4).

Status (`contract_cycle_status`):

```
scheduled ─hold─▶ authorising ─▶ authorised ─capture─▶ capturing ─▶ captured
   │                 │ decline (hold)                       │ hold lost / capture refused
   │                 ├───────▶ grace ─retry─▶ authorising   └──────▶ capture_failed (incident)
   │                 │ decline (immediate / resume charge)
   │                 └───────▶ suspended ─resume─▶ authorising ─▶ captured
   ├─ total = 0 ─────▶ empty       (nothing to charge)
   ├─ total < 50¢ ───▶ carried     (service value carried into the next cycle)
   └─ contract ended or cancelled ─▶ cancelled (any hold released)
```

`resume_from` records the instant a resume charge was quoted at: only the
sessions starting after it are charged and reactivated.

`charge_mode` records what `authorising` is doing: `hold` (manual capture),
`immediate` (late booking: authorise and capture at once) or `resume`
(prorated remainder after suspension, or recovery after a system failure).

### What the tick does with a cycle

- **`scheduled` and `now ≥ hold_at`**, contract billable (`scheduled`/`active`):
  1. Helper not payment-ready (strict `isPaymentReady`) → no hold; at
     `starts_at` the cycle is suspended with reason `helper_not_ready`, and
     both parties and an admin are told.
  2. Amounts are quoted (§3). Total 0 → `empty`; below 50¢ → `carried`.
  3. **Late booking**: the contract became billable (`billable_from`: the
     acceptance, or the moment the helper became ready) after this cycle's
     `hold_at` *and* less than the hold lead before its first session → `immediate`
     charge. On a decline the cycle is `suspended` at once (no grace; the first
     session is not activated) and the family is told to update the card.
  4. Otherwise a `hold` — an off-session authorisation with manual capture.
- **`grace`** — a hold declined for a card reason. On the first decline the
  family is told to update their card and the helper that payment is pending.
  Retried every `CONTRACT_BILLING_RETRY_HOURS` (default 12) and **immediately
  when the family replaces the card**. Still unfunded at `starts_at` →
  suspended (§4). A retry after `capture_at` is an immediate charge.
- **`authorised` and `now ≥ capture_at`** — the pre-cycle recheck: the helper
  must still be payment-ready, otherwise the hold is released, the cycle
  suspended (`helper_not_ready`) and both parties plus an admin are told. Then
  capture `min(held, current value of the cycle's scheduled sessions)`
  (partial capture releases the rest), key `capture-<cycleId>`.
- **`captured`** — funded; its sessions complete as they end.
- A **provider error** (Poppynz/Stripe, not the card) is never treated as a
  decline: the attempt stays pending and the next tick retries under the same
  key. Still unfunded at `starts_at` → suspended with reason
  `provider_unavailable` (the family is not asked to change anything), an
  admin is alerted, and later ticks retry the resume by themselves.
- **System failure after funding** — a hold that expired or vanished, or a
  capture refused after a successful hold: `capture_failed`, a
  `billing_incidents` row and an immediate admin alert. The cycle was
  represented as funded, so care goes ahead and the helper's share stays owed
  (Poppynz funds it; transfers are piece 4); one recovery charge on the
  family's card is attempted. Later cycles keep the normal charge gate, so no
  new unfunded cycle can start.

Idempotency keys: hold and charge attempts `cycle-<cycleId>-<attempt>` (a
declined attempt has to be retried under a new key — Stripe replays a key's
outcome for 24 h), captures `capture-<cycleId>`. Every key starts from the
cycle id.

## 3. Amounts and fees (umbrella §6 "Amounts and fees")

Per cycle, quoted when the hold (or charge) is placed and frozen on the cycle
and its payment row:

```
service       = Σ session.value_cents (scheduled sessions) + carried_in_cents
serviceTax    = tax lines on service       (care_service_value — exempt by default)
familyFee     = roundHalfUp(service × familyFeeBps / 10000)
familyFeeTax  = tax lines on familyFee     (family_service_fee)
total         = service + serviceTax + familyFee + familyFeeTax  ← charged to the family
commission    = roundHalfUp(service × providerCommissionBps / 10000)
commissionTax = tax lines on commission    (provider_commission)
helperShare   = service + serviceTax − commission − commissionTax ← piece 4 transfers this
```

- Example (Ontario family, Manitoba helper, $600 of service, seeded tax
  config): fee $30.00 + HST (ON) 13% $3.90 → the family pays $633.90;
  commission $90.00 + GST (MB) 5% $4.50 → the helper receives $505.50; Poppynz
  keeps $120 of fees and remits $8.40 of tax.
- **Carry-over**: a cycle whose total would be below 50¢ is `carried`; its
  service value is added to the next cycle's. The last cycle has no next one:
  Poppynz absorbs it (`carry_absorbed`, at most 49¢).
- **Ledger** (`billing_ledger_entries`, unique `entry_key`, so a rerun never
  duplicates): written when a cycle is captured — one `session` entry per
  session, `family_fee`, `family_fee_tax`, `provider_commission`,
  `provider_commission_tax` (and `service_tax` when non-zero), `capture` —
  plus `carry_forward`, `carry_absorbed` and `hold_released` when they happen.

## 3a. Tax (umbrella §6 "Tax"; user decisions of 2026-10-24)

Tax configuration is **data in the database**, seeded with defaults, so an
accountant (a later role and portal — not built here) can correct it. Nothing
tax-related is hard-coded or env-only; the code holds only the rounding rule
and the resolution algorithm.

### Model (migration `0027_tax_config`)

| Table | Contents |
|---|---|
| `tax_jurisdictions` | `code` (PK: `CA` federal, `AB` … `YT`), `name`, `kind` (`federal` \| `province` \| `territory`) |
| `tax_rates` | `jurisdiction_code`, `component` (`gst` \| `hst` \| `pst` \| `qst` \| `rst`), `rate_millipercent`, `effective_from`, `effective_to` (exclusive, nullable), `deleted_at` |
| `tax_supply_types` | `code` (PK): `family_service_fee`, `provider_commission`, `credibled_check`, `credibled_admin_fee`, `care_service_value`, `cancellation_compensation`; `name` |
| `tax_supply_treatments` | `supply_type_code`, `treatment` (`taxable` \| `exempt` \| `zero_rated` \| `out_of_scope`), `components` (array), `place_of_supply` (`payer_province` \| `helper_province` \| `contract_location`), effective dates, `deleted_at` |
| `tax_registrations` | `jurisdiction_code`, `program` (`gst_hst`, `qst`, …), `components` covered, `registration_number`, `registered`, `is_placeholder`, effective dates, `deleted_at` |
| `tax_config_audit` | Append-only: `entity`, `record_id`, `action` (`create` \| `supersede` \| `delete`), `actor_user_id`, `reason`, `before`, `after` (jsonb), `created_at` |

- **Units**: `rate_millipercent` is thousandths of a percent (basis points ×
  10): 5% = `5000`, 13% = `13000`, 9.975% = `9975`. A tax line is
  `roundHalfUp(base × rate_millipercent / 100000)`.
- **Never mutate history.** Rates, treatments and registrations are
  effective-dated with `[effective_from, effective_to)`. An edit closes the
  row in force (`effective_to` = the new row's `effective_from`) and inserts
  the new row, in one transaction with its audit row. A removal sets
  `deleted_at` (and is audited). Overlaps per `(jurisdiction, component)`,
  per supply type and per `(jurisdiction, program)` are refused by `EXCLUDE
  USING gist` constraints (`btree_gist`) on the live rows, and checked first
  by the repo so callers get a typed `TaxConfigOverlapError`.
- **Repo** (`TaxConfigRepo`): reads — `listJurisdictions`, `listRates`,
  `listSupplyTreatments`, `listRegistrations` (with `includeHistory`),
  `snapshotOn(date)`, `listAudit`; writes — `supersedeRate`, `deleteRate`,
  `supersedeSupplyTreatment`, `supersedeRegistration`, each taking `{ actor,
  reason }` and writing the audit row in the same transaction. The accountant
  portal builds on exactly these.

### Resolution (`computeSupplyTax` in `@repo/billing/pricing`, pure)

Input: the config snapshot in force on the supply date, the supply type, the
base amount, and the provinces (`payer`, `helper`, `contract`).

1. The supply type's treatment in force; none → `TaxTreatmentMissingError`.
   Anything but `taxable` → no tax lines.
2. The place of supply picks the province; unknown → `TaxProvinceRequiredError`.
3. For each listed component: skipped unless a registration in force with
   `registered = true` covers it; otherwise the province's rate for that
   component in force, if any, makes one line.
4. A taxable supply where some listed component is registered but no rate
   applies at all → `TaxRateMissingError`. Never a silent 0.

Each line is frozen as `{ supplyType, jurisdiction, component, rateMillipercent,
baseCents, taxCents, label, registrationNumber }` on the payment row
(`payments.tax_lines`) and on the cycle, so a later edit never changes an
existing charge. Labels read `HST (ON) 13%`, `GST (MB) 5%`, `QST (QC) 9.975%`.

### Seeded defaults (seed `0004_tax_config`)

- Jurisdictions: `CA` and the 13 provinces and territories.
- Rates: GST 5% in AB, BC, MB, SK, QC, NT, NU, YT (from 2008-01-01); HST 13%
  ON (from 2010-07-01); HST 15% NB, NL (from 2016-07-01), PE (from
  2016-10-01); HST NS 15% 2010-07-01 → 2025-04-01, 14% from 2025-04-01; QST
  9.975% QC (from 2013-01-01); PST BC 7% (from 2013-04-01), PST SK 6% (from
  2017-03-23), RST MB 7% (from 2019-07-01) — seeded but not applied: no
  treatment lists `pst` or `rst`.
- Treatments (from 2008-01-01): `family_service_fee` taxable, `[gst, hst, qst]`,
  `contract_location`; `provider_commission` taxable, `[gst, hst, qst]`,
  `helper_province`; `credibled_check` and `credibled_admin_fee` taxable,
  `[gst, hst, qst]`, `payer_province`; `care_service_value` exempt
  (`contract_location`); `cancellation_compensation` out of scope.
- Registrations: `gst_hst` (CA, covers `gst` and `hst`) registered, number
  `PLACEHOLDER-000000000RT0001`; `qst` (QC) registered, number
  `PLACEHOLDER-1000000000TQ0001` (user decision 2026-10-24: QST is ON by
  default) — both `is_placeholder = true`. A Quebec payer is charged GST 5% +
  QST 9.975% on each taxable supply; switching a registration off stops that
  component.
- The defaults live in `@repo/db/tax-defaults`, used by the seed and as test
  fixtures; runtime code only reads the tables.
- Permissions: `tax: ['read', 'write']` and `taxReport: ['read']`, granted to
  admins now and to the accountant role the portal adds later (always checked
  with `requirePermissions`, never by role).

### Where the provinces come from

- The profile's `state_province` (`ON` or `Ontario`), Canada only.
- Contracts: the family's province is the contract location; the helper's is
  the helper's profile. Both are frozen on `contract_billing` at acceptance
  and both are needed to accept (and the family's to send); without one the
  action answers `422 TAX_PROVINCE_REQUIRED`, naming whose profile needs it.
- Background checks: the payer's province (family or helper).
- The supply date is the cycle's first day (contract zone), or the quote's day
  for a check payment.

### Background-check payments (piece 2a, changed)

The quote now taxes the checks (`credibled_check`) and the administration fee
(`credibled_admin_fee`) by the payer's province. A $5.00 fee in Ontario shows
`HST (ON) 13% $0.65`. The frozen lines are stored on the payment row with
`tax_cents`, shown at checkout and in the billing history, and written into
the PaymentIntent description (with Poppynz's registration number) so
Stripe's receipt carries them. `SAFETY_VERIFICATION_TAX_RATE_BASIS_POINTS` is
removed. Without a province the summary carries no quote
(`quoteBlockedReason: 'tax_province_required'`) and ordering answers
`422 TAX_PROVINCE_REQUIRED`.

## 4. Declines, suspension and resume (umbrella §6)

- **Suspension** at `starts_at` of an unfunded cycle: `contract_billing.status
  = suspended` with `suspended_reason` (`card` | `helper_not_ready` |
  `provider_unavailable`), the cycle `suspended`, its sessions `suspended`
  (never billed). The helper is told not to work those dates; for `card` the
  family is told to update the card. A later cycle that starts while the
  contract is suspended is suspended too — no hold is placed meanwhile.
- **Resume**: once the cause is fixed (the family replaces the card, the
  helper becomes ready, the provider answers again), the **prorated rest of
  the current cycle** — its sessions that have not started yet — is charged
  immediately. On success those sessions are `scheduled` again, the contract
  `active`, and both parties get an email with the amount and dates. If the
  effective end has passed nothing is charged and the billing ends. The next
  cycle follows the normal schedule (held at once when its `hold_at` passed).

## 5. Payment-readiness gate (umbrella §6)

- At acceptance, a helper who isn't payment-ready puts the contract in
  `awaiting_payment_readiness`. No hold is placed.
- Reminders to the helper at acceptance and 7, 3 and 1 days before the start
  date (contract zone; thresholds already passed at acceptance are skipped);
  the family is copied from the 3-day reminder. `reminders_sent` makes each go
  once.
- Every tick re-checks readiness; once ready → `scheduled`, `billable_from =
  now`, and cycle 1 proceeds (late-booking rule included).
- Deadline = cycle 1's `capture_at`. Still not ready → billing `cancelled`,
  the contract ended (`status = ended`, note "Cancelled — the helper's payout
  account wasn't ready in time"), sessions and cycles cancelled, nothing
  charged, both parties notified.

## 6. Notices

- Realtime: a new `contract.billing` event `{ contractId, kind }`, so an open
  contract or billing page refetches.
- Email: `Mailer.sendContractBillingNotice` (one template keyed by `kind`):
  `readiness_reminder`, `cancelled_not_ready`, `hold_declined` (family),
  `payment_pending` (helper), `suspended`, `resumed`, `helper_not_ready`,
  `charge_failed`.
- Admin alerts (`Mailer.sendAdminBillingAlert`, to `ADMIN_NOTIFICATION_EMAILS`):
  `helper_not_ready`, `provider_unavailable`, `capture_failed`.
- Notices are best-effort: a failed send is logged and never undoes a state
  change. Routine holds and captures send no email; the family sees them in
  Billing.

## 7. API

- **Send** additionally refuses a family without a province.
- **Accept** resolves both provinces (refusing with `TAX_PROVINCE_REQUIRED`),
  freezes the rates, and inserts the `contract_billing` row in the acceptance
  transaction; then it runs the contract's billing step once
  (`runContractBilling(contractId, now)`), so a late booking is charged as
  soon as it is binding. A failure there is logged and left to the tick.
- **Contract detail**: each version gains `pricing` (the weekly breakdown, the
  viewer's side only — the family sees fee and tax added, the helper sees
  commission and tax deducted; frozen rates after acceptance, current ones
  before; `null` with a reason when a province is missing), and the contract
  gains `billing` (status, suspension reason, readiness deadline, and its
  cycles: dates, sessions, hours, status and the viewer's amounts).
- **Card replaced** (`POST /billing/card/confirm`, and the
  `setup_intent.succeeded` webhook): retries the family's `grace` cycles and
  resumes their `card`-suspended contracts at once.
- **Billing history**: contract charges listed with their description ("Care
  with Sam T. · Nov 2–4, 2026"), tax lines, and `authorised` shown as "On
  hold".
- **Webhook**: `payment_intent.amount_capturable_updated` joins the settle
  events.

## 8. Payment port additions

| Operation | Contract |
|---|---|
| `chargeSavedCard({ amountCents, currency, customer, card, capture, idempotencyKey, metadata, description })` | Off-session PaymentIntent created and confirmed in one call; `capture` is `manual` (a hold) or `automatic`. A decline is **data** (`status: 'failed'`, `failureReason`), not an error; only provider trouble fails (`PaymentProviderError`) |
| `capturePayment({ reference, amountCents, idempotencyKey })` | Captures a hold; a partial capture releases the rest |
| `cancelPayment` (existing) | Also releases a hold |

`ProviderPaymentStatus` gains `authorised` (Stripe `requires_capture`);
`ProviderPayment` gains `capturableCents`, `receivedCents` and
`captureBefore`. `startPayment` gains an optional `description`. The mock holds
and captures at once; a saved card whose reference contains `decline` is
refused, so tests reach every path.

## 9. Data (migrations `0027_tax_config`, `0028_payment_tax_lines`, `0029_contract_billing`)

- `payments.tax_lines` (jsonb), `payments.description`,
  `payments.captured_cents`; `payment_kind` gains `contract_cycle`.
- The tax tables of §3a.
- `contract_billing`, `contract_cycles`, `contract_sessions`,
  `billing_ledger_entries`, `billing_incidents`, and enums for their statuses.
- Umbrella §10: every new foreign key is `restrict`; `payments.user_id`,
  `contracts.family_user_id` and `contracts.provider_user_id` move from
  `cascade` to `restrict`.

## 10. Local verification (dev only)

- `docker compose exec worker sh -c 'cd /usr/src/app && ENVIRONMENT=dev BILLING_DEV_CLOCK=enabled bun apps/worker/src/dev/billing-tick.ts --as-of <ISO instant> [--contract <id>]'`
  runs exactly the worker's tick with "now" set to that instant, and prints
  each contract's cycles (status, amount, hold/capture/start instants). It refuses to
  start unless `ENVIRONMENT=dev` is set explicitly **and**
  `BILLING_DEV_CLOCK=enabled`; with `ENVIRONMENT=production` it always exits.
  Payment readiness is still checked against Stripe's real state, and holds
  are real test-mode authorisations placed at the real time.
- `docker compose exec worker sh -c 'cd /usr/src/app && ENVIRONMENT=dev BILLING_DEV_CLOCK=enabled bun apps/worker/src/dev/billing-fixture.ts [--payout-account <acct_…>]'`
  creates (idempotently) a test family (`billing-family@example.test`,
  Toronto, Ontario) and a test helper (`billing-helper@example.test`,
  Winnipeg, Manitoba),
  both approved and verified, with a helper service and an active
  conversation, so a contract can be created in the UI. `--payout-account`
  links the helper to a test Connect account made with
  `packages/payments/scripts/e2e-payout-account.ts create-ready`. Same guards.

## 11. Testing

- `@repo/billing/pricing`: rounding; tax resolution per province with the
  seeded snapshot (each province, NS before/after 2025-04-01, QST only when
  registered, exempt and out-of-scope supplies, unknown province, taxable
  supply without a rate, labels); the $600 example.
- `TaxConfigRepo` (against Postgres): supersede closes and inserts with an
  audit row, overlaps refused, soft delete, `snapshotOn`.
- Schedule planning (pure): cycles and instants across DST, partial last
  cycle, last-day end time, the 14-day window, capture at first session − 1 h.
- Cycle engine with in-memory repos and the mock provider: hold → capture,
  decline → grace → retry on card replacement, grace → suspended → resume
  (prorated), late booking (success and decline), readiness gate (reminders,
  ready later, cancellation at the deadline), helper not ready at capture,
  provider error → `provider_unavailable`, lost hold → incident, carry and
  absorb, a lost compare-and-set.
- Port: the Stripe adapter (off-session, manual capture, idempotency keys,
  decline as data, partial capture) against the fake client; the mock.
- API: accept creates billing and refuses without provinces; detail `pricing`
  and `billing` per side; card replacement triggers retries; the check
  quote's tax lines and `TAX_PROVINCE_REQUIRED`.
- Worker: the tick job and the dev-clock guards.
- Web: mount tests for the price breakdown and the billing panel.
