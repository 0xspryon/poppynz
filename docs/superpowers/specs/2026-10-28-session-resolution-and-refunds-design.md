# Session resolution, refunds and helper transfers (Tier 3) — design

Status: **draft for review, 2026-10-28.** Decisions marked ✅ were agreed with the
user on 2026-10-28; items under "Open decisions" need an answer before the step
that depends on them starts.

Related: [umbrella billing design](2026-09-24-stripe-contract-billing-design.md)
(§7 session resolution, §8 helper payouts, §9 card disputes),
[contract billing (piece 3)](2026-10-24-contract-billing-design.md).

## 1. Scope and order ✅

Tier 3 of the UAT round-2 feedback is phases 4 and 5 of the umbrella plan. It is
built in this order, each step its own branch, reviewed and browser-tested:

1. **Session events and actions** (no money): days off, cancellations, reports,
   disputes, the other side's response, the admin dispute queue. UAT item 11b.
   Step 1 deliberately leaves billing unchanged: resolutions are recorded,
   confirmed, contested and decided, but nothing they say changes what is
   held, charged or paid — not even `contract_sessions.status`, because the
   engine charges every `scheduled`/`completed` session and a `cancelled` or
   `disputed` one would silently drop out of the next quote. The outcome is
   shown from the resolution; step 2 applies the money (and the status).
1b. **Replacement from a template**: from a helper's cancellation, the family
   picks another helper (search filtered by the cancelled service) and gets a
   short draft contract pre-filled from the current contract's terms for the
   affected dates. Builds on "start a new contract from this one" (UAT item 7b),
   which already copies terms for the *same* helper; the new parts are choosing a
   different helper, re-pricing to that helper's rates (floored at base rates)
   and limiting the draft to the affected dates.
2. **Money effects + helper transfers**: the frozen per-session split, the
   cancellation-policy function, session-linked refunds, session-based transfers,
   held-back pay for disputed sessions, restricted-account handling and the manual
   payout queue.
3. **Extra sessions**: either side adds an unscheduled session, the other confirms,
   charged after a 1-hour delay. UAT item 12.
4. **Card disputes (chargebacks)**: records, evidence, and recovery from the
   helper's next transfers where the policy says the helper bears it.
5. **Accountant reimbursements and reconciliation**. UAT item 9.

Contract versioning (UAT item 8) stays deferred; "start a new contract from this
one" covers it.

## 2. Remedies ✅

- **Refunds first.** Money owed back to a family after a charge is refunded to the
  card that paid. Credits ("apply to my next charge") are a later, optional
  remedy built on the same structures (`remedy: refund | credit`).
- **Every refund is tied to the session that caused it.** A cycle is a group of
  sessions; refunds, compensation and helper pay are all computed per session.
- Before money is taken, nothing is refunded: a session resolved before its
  cycle's hold is simply left out of the plan; one resolved after the hold but
  before the charge reduces the capture.

## 3. Sessions beyond the 14-day window ✅

Decided 2026-10-28: **no separate time-off ranges.** Sessions are materialised
on the existing **rolling 14-day window** (contract billing §5) and every action
(cancel, day off, report, dispute) acts on a session that exists. A date further
out has no session yet, so nothing can be recorded for it until it appears.

Why this is acceptable: cancelling at least 24 hours before a session costs the
family nothing and pays the helper nothing (§6), so waiting until a date enters
the window never changes the money. A session resolved before its cycle's hold
is simply left out of the plan — no per-session money breakdown exists until a
cycle is charged (§5.3).

What the UI must explain (EN and FR), wherever sessions are listed — the cycle
page, the contract's billing panel and the session actions:

- Sessions appear **14 days ahead**. The number comes from
  `SESSION_WINDOW_DAYS` in `@repo/billing` (the constant the worker uses),
  returned by the API with the sessions — the web never hard-codes "14".
- To take a day off or a holiday further out, come back when those dates appear;
  cancelling **at least 24 hours** before a session is free for the family.
- The weekly schedule on the contract still shows the agreed pattern for every
  week; only individual sessions (the ones you can act on) are limited to the
  window.

A long-holiday planner (date ranges recorded ahead and applied as sessions are
created) can be added later without changing anything above; it was considered
and deferred.

## 3a. Responses, days off and notices ✅

Decided 2026-10-28:

- **Response window: 48 hours.** A one-sided report (e.g. "helper didn't
  show", "family cancelled late") is `proposed`; the other side has 48 hours from
  `recorded_at` to accept or contest it. **Silence counts as acceptance**: a worker
  step confirms unanswered reports when the window closes. A contested report
  goes to the admin dispute queue.
- **Days off need the other side's confirmation.** A day off is proposed by
  either side and only takes effect when the other side confirms; an unconfirmed
  proposal does not change the session. (The 48-hour silence rule does not apply
  to day-off proposals; they lapse at the session's 24-hour cutoff.)
- **A family's day off is a family cancellation** (free if recorded at least
  24 h before the session; helper $0) and **a helper's day off is a helper
  cancellation** (helper $0; family owed the full session) — with the agreed
  label and reason shown.
- **Both parties are always emailed** (EN/FR, each in their own language) when a
  report, day off or cancellation is recorded, confirmed, contested, lapses, or is
  decided by an admin.
- **Helper-initiated cancellation email to the family** carries a call to action
  to find a replacement quickly: search for another helper offering the same
  service, and start a short contract pre-filled from the current contract
  ("templated contract"). For step 1 only the **copy** ships; the link points to
  Find help filtered by the session's service until the replacement flow exists
  (§1, step 1b).

## 4. Data model (steps 1–2)

### 4.1 `session_resolutions` (step 1)

What happened to one session. One *active* resolution per session (partial unique
index on `session_id` where `status <> 'reversed'`).

| column | notes |
|---|---|
| `id`, `contract_id`, `session_id`, `cycle_id` | |
| `kind` | `family_cancelled_early`, `family_cancelled_late`, `family_no_show`, `family_reduced_hours`, `helper_cancelled`, `helper_no_show`, `day_off_agreed`, `disputed` |
| `reported_by_user_id`, `reported_by_side` | `family` / `helper` / `admin` |
| `recorded_at` | the instant the 24-hour rule measures (founder §7: a phone call doesn't count until recorded) |
| `reason`, `note` | reason code + free text |
| `minutes_worked` | for early dismissal / reduced hours |
| `status` | `proposed` → `confirmed` / `contested` → `decided` (admin) ; or `reversed` |
| `responded_by_user_id`, `responded_at`, `response_note` | the other side's answer |
| `decided_by_user_id`, `decided_at`, `decision`, `decision_reason` | admin outcome for contested items |
| `policy_version` | the cancellation-policy (Terms of Service) version from the signed agreement snapshot |

Session status keeps its short enum; details live here so new outcomes don't
change the enum.

### 4.2 `contract_session_charges` (step 2)

The frozen per-session split, written in the same transaction as the cycle's
capture (see §5). One row per charged session: `session_id`, `cycle_id`,
`payment_id`, `care_cents`, `family_fee_cents`, `family_fee_tax_lines` (jsonb,
per jurisdiction/component), `family_total_cents`, `commission_cents`,
`commission_tax_lines`, `helper_share_cents`.

### 4.3 `session_refunds` (step 2)

One row per refund; always one session. `id` (also the Stripe idempotency key),
`session_id`, `resolution_id`, `cycle_id`, `payment_id`, `care_cents`,
`fee_cents`, `fee_tax_lines`, `total_cents`, `status`
(`pending|succeeded|failed|cancelled`), `provider_reference` (`re_…`),
`failure_reason`, timestamps. Constraints: refunds for a session ≤ its
`family_total_cents`; refunds on a payment ≤ the payment's captured amount.

### 4.4 Ledger kinds (step 2)

`session_refund_care`, `session_refund_fee`, `session_refund_fee_tax`,
`cancellation_compensation`, `commission_reversal`, `commission_tax_reversal`,
`transfer`, `transfer_held`, `transfer_reversal`. Each entry carries
`session_id`; its key is derived from the resolution or refund id so re-writing
is a no-op.

## 5. The per-session split (proportional allocation) — why

### 5.1 The problem

The family fee and the taxes are **computed once per cycle, on the cycle total,
then rounded to cents** (contract billing §6; one rounding rule shared by holds,
captures and display). Computing them again per session and rounding each one
gives a different total:

> Two $62.50 sessions. Cycle: care $125.00 → fee 5% = **$6.25** → HST 13% on the
> fee = **$0.81**; family pays **$132.06**.
> Per session: fee 5% × 62.50 = 3.125 → **$3.13**, twice = **$6.26**; HST 13% ×
> 3.13 = 0.4069 → **$0.41**, twice = **$0.82**; total **$132.08**.

Refunding sessions with their *recomputed* amounts would refund 2¢ more than
was charged over the two sessions — and Stripe refuses refunds above the
captured amount, the tax report would show tax returned that was never
collected, and the ledger would not balance.

Recomputing the cycle per session the other way round (charge = sum of rounded
session amounts) would change every price already shown and quoted, and make the
family's charge depend on how the week happens to be split into sessions.

### 5.2 The rule

**Each cycle amount that was actually charged is divided among the cycle's
charged sessions in proportion to their care value, using the largest-remainder
method, and the result is frozen.**

For each component C (fee, each fee-tax line, commission, each commission-tax
line):

1. For each session *i*: exact share = C × (value_i / Σ value). Take the floor in
   cents.
2. The leftover cents (C − Σ floors, always fewer than the number of sessions)
   go one each to the sessions with the largest fractional remainders; ties go to
   the earlier session (by start time, then slot).
3. Care is not allocated — each session's care is its own value. Helper share =
   care − commission − commission tax, per session.

Properties, all tested:

- **Exact:** for every component, the session shares add up to the cycle amount
  to the cent. Refunds per session can never total more (or less) than what was
  charged.
- **Fair:** a session's share of the fee and taxes is proportional to its value;
  a 5-hour session carries twice the fee of a 2.5-hour one.
- **Stable:** deterministic (no randomness, fixed tie-break), so re-running the
  split gives the same cents; frozen at capture so later tax-rate or fee changes
  never move past amounts.
- **Tax-correct:** each session's tax lines keep the jurisdiction, component and
  rate that were charged, so a refunded share reduces exactly the tax that was
  collected.

Worked example (the cycle above):

| | Mon | Wed | Cycle |
|---|---|---|---|
| Care | 62.50 | 62.50 | 125.00 |
| Family fee | 3.13 | 3.12 | 6.25 |
| HST (ON) on fee | 0.41 | 0.40 | 0.81 |
| **Family paid** | **66.04** | **66.02** | **132.06** |
| Commission | 9.38 | 9.37 | 18.75 |
| GST (MB) on commission | 0.47 | 0.47 | 0.94 |
| **Helper share** | **52.65** | **52.66** | **105.31** |

(Fee 6.25: exact shares 3.125 and 3.125, floors 3.12 + 3.12, one leftover cent →
tie → earlier session (Mon). HST 0.81: 0.405 each → 0.40 + 0.40, one cent → Mon.)

### 5.3 When the split is made

At capture, from the amounts actually captured (so a capture smaller than the
hold is split from the smaller amount). Sessions excluded before capture
(resolved before the hold, or before the charge) are not in the split.
Carried-in amounts (sub-50¢ carries from an earlier cycle) are a separate line
and are not allocated to sessions.

## 6. The cancellation-policy function (step 2)

A pure function `resolveSessionMoney(split, resolution, policyVersion)` returns
`{ familyRefund, helperOwed, poppynzKeeps }` with component breakdowns. It
computes one side and derives the other by subtraction so the cents always add
up. Rules (founder-approved policy v1):

| Resolution | Helper | Family | Poppynz |
|---|---|---|---|
| Family cancels ≥ 24 h before start (incl. a day off recorded in time) | $0 | full session total (care + fee + fee tax) | $0 on this session |
| Family cancels < 24 h, no-show, early dismissal, reduced hours | worked time paid normally + 25 % of the cancelled care value (rounded half-up, untaxed by default) | cancelled care − compensation + the session's whole fee and fee tax | no commission on cancelled hours |
| Helper cancels / no-show | $0 for unworked time | full unworked care + fee + fee tax | $0 |
| Agreed day off before the cutoff | $0 | full session total | $0 |
| Disputed | held back | held back | — until the admin decides, then one of the rows above (or a partial) |

Example — Wednesday cancelled late by the family: helper 25 % × 62.50 = 15.625 →
**$15.63**; family refund = (62.50 − 15.63) + 3.12 + 0.40 = **$50.39**;
15.63 + 50.39 = 66.02 = what was paid for that session. The 24-hour boundary is
measured from `recorded_at` to the session's start, in the contract time zone
(exactly 24 h is timely).

## 7. Applying a resolution (step 2)

One "apply" step computes what is owed back for the session, then picks the
mechanism from the cycle's state:

| Cycle state | Mechanism | Refund row |
|---|---|---|
| not yet held | session left out of the plan | no |
| held, not charged | capture reduced for that session | no |
| charged | partial Stripe refund on the cycle's charge | yes |
| charged and helper paid | partial refund + session-level recovery from the helper, deducted from their next transfers until repaid | yes + recovery |

The resolution, refund row and ledger entries are written in one transaction,
guarded so a session cannot be resolved twice; a worker step calls Stripe; the
existing webhook/settle path marks refunds succeeded or failed.

**Stripe:** one charge per cycle; Stripe supports several partial refunds on one
charge up to the captured amount. Each refund carries metadata `refund_id`,
`session_id`, `cycle_id` and uses `refund_id` as its idempotency key. Stripe
knows the charge total and how much is refunded; Poppynz knows which session
each cent belongs to. A failed refund goes to the accountant's queue; refunds
are blocked while a card dispute on that charge is open.

## 8. Helper transfers become session-based (step 2)

The end-of-cycle transfer is the sum of session payables: completed → frozen
share; late family cancellation → 25 % compensation; disputed → held back;
helper cancellation → $0. Each transfer records the sessions it paid; a held
session is paid (or not) when the admin decides; a later dispute recovers that
session's amount from the helper's next transfers. Transfers use `source_transaction` (the cycle's charge).
Restricted accounts pause that helper's transfers; after 60 days the payable
moves to the manual payout queue (subject to legal sign-off on e-Transfer, see
the Interac research note).

## 9. Tax and the accountant

A session refund returns the fee's tax from the session's frozen tax lines (same
jurisdiction, component, rate). The tax-collected report subtracts it **in the
refund's period**. Receipt / credit-note wording to be confirmed by the
accountant (Open decision 7). The reimbursements view (step 5) lists refunds and
recoveries per session.

## 10. What people see

- **Cycle page:** the actions column offers, per session and per role, the
  actions allowed at that moment (cancel, report no-show, report reduced hours,
  dispute, respond). Each row shows its outcome and refund status.
- **Explaining the window:** wherever sessions are listed, a short note says
  sessions appear 14 days ahead and that cancelling at least 24 hours before a
  session is free for the family (§3).
- **Before confirming** any action both the outcome and the money are shown
  ("Cancelling now: Hana receives $15.63, you get $50.39 back").
- **Billing history:** refunds under their cycle's charge, labelled with the
  session's date and service, each with a receipt. EN/FR emails to both sides.
- **Admin:** dispute queue with both statements, the session, nearby messages,
  the signed agreement snapshot and policy version; every decision audited.

## 11. Testing

- Split: exactness for every component over many random cycles (incl. partial
  captures and carries), tie-break stability.
- Policy function: every row of §6, the exact 24 h boundary in the contract
  zone, DST nights.
- Apply step at each cycle state; idempotency (double click, duplicate webhook,
  worker retry); limits (no refund above a session's share or the charge).
- Actions are refused (typed error) for dates outside the window; the window
  note renders with the configured length in EN and FR.
- Mock payments provider: partial refunds and refund failures.
- Dev billing clock: `--as-of` covers transfers, response windows and the
  extra-session delay.

### 11.1 Stripe facts (confirmed in test mode, 2026-10-28, API 2026-09-30.endive)

- **Several partial refunds per PaymentIntent** work, up to the captured
  amount exactly (5039 + 6602 + 1565 of 13206 → `refunded: true`). Above
  what is left Stripe answers `StripeInvalidRequestError` "Refund amount
  ($20.00) is greater than unrefunded amount on charge ($15.65)", and on a
  fully refunded charge `charge_already_refunded`. Under the same
  idempotency key the error is replayed, so it is a **refusal** (the refund
  goes to the failure list), not an outage to retry. The same key with other
  parameters is a `StripeIdempotencyError`. Metadata (`refund_id`,
  `session_id`, `cycle_id`, …) is kept on the refund.
- **Refund lifecycle:** card refunds come back `succeeded` at once. With the
  refund-failure test card (`pm_card_refundFail`) the refund is created
  `succeeded` and turns `failed` (`expired_or_canceled_card`) a minute or
  two later, announced by `charge.refund.updated` / `refund.failed`: a
  refund can go **succeeded → failed**, and the settle step accepts that.
- **`source_transaction` transfers** are capped at the charge's amount minus
  its refunds minus the transfers already made from it ("Transfers using
  this transaction as a source must not exceed the source amount of $72.06.
  (Source available amount change could be linked to partial/complete
  refunds of the charge …)"). A refund made after a transfer is not blocked
  (it comes out of the platform balance). So a transfer that no longer fits
  under its charge (a follow-up paying a session whose full refund was
  absorbed) is sent from the platform balance instead; the choice is stored
  on the transfer before the call so a retry repeats the same request.
- With **pending funds** (4242) a `source_transaction` transfer is accepted
  at once (the charge's balance transaction is `pending`); the money becomes
  available on the connected account when the charge's funds do. With
  `pm_card_bypassPending` (4000 0000 0000 0077) the funds are available at
  once. Without `source_transaction` a transfer needs available platform
  balance (`balance_insufficient` otherwise).
- **`source_transaction` must be the charge (`ch_…`)**: a PaymentIntent id
  fails with `resource_missing`. `latest_charge` on the captured intent is
  that charge.
- **Transfer refusals** are `StripeInvalidRequestError`s: a destination
  without the transfers capability → `insufficient_capabilities_for_transfer`;
  an unknown destination → `resource_missing`; no balance →
  `balance_insufficient`; above the source → no code (message above).
  Readiness is checked first, so a not-ready account pauses the transfer
  rather than reaching Stripe.
- **`payout.*` events** of a connected account arrive through
  `stripe listen --forward-connect-to` with `event.account` set (`connect
  payout.created / updated / paid`), signed with the same `whsec_…` locally.

## 12. Open decisions

1. ~~Time off for dates beyond the window~~ — decided: no; act within the 14-day
   window, explained in the UI (§3).
2. ~~Response window~~ — decided: 48 h, silence counts as acceptance (§3a).
3. ~~Days off~~ — decided: need the other side's confirmation; family day off =
   family cancellation, helper day off = helper cancellation; both always
   emailed (§3a).
4. ~~Past extra sessions~~ — decided: up to 14 days back, no further (step 3).
5. ~~Re-signing~~ — default (2026-10-28): existing contracts don't re-sign. Each
   extra session needs the family's explicit "I authorise this charge" when
   confirming it; new contracts get the consent clause in the next agreement
   template version (step 3).
6. ~~Manual payouts~~ — decided: each needs approval by at least one admin (step 2).
7. ~~Tax on refunds~~ — default (2026-10-28): a refund reduces tax collected in
   the refund's period; the family receives a refund receipt (credit note)
   listing the tax returned. The accountant can change the treatment later
   (step 2).
8. ~~Recovery from a helper~~ — decided: recovered from the helper's earnings
   going forward (deducted from their next transfers until repaid), not by
   reversing past transfers (step 2).

## 13. Defaults taken after the step-2 review (2026-10-28)

Chosen by the coordinator while the user was away; revisit if needed.

1. **Dispute raised after the helper was paid:** the session's pay is already
   out, so the dispute holds an equal amount back from the helper's next
   transfer until the admin decides. Decided against the helper → the held
   amount becomes the recovery; decided for the helper → it is released. This
   is the behaviour step 2 shipped and matches decision 8 (recovery from future
   earnings) in effect.
2. **Refund settled outside Stripe ("marked handled"):** counts as refunded for
   tax — the refunded tax lines appear in the tax report in the month it was
   marked handled, with the admin's note. Implemented in step 5 (accountant).
3. **Commission tax on a cancelled session** is reversed when the session's
   money is resolved (refund succeeded, or excluded/reduced before capture),
   not only on a successful refund. Implemented in step 5 with (2).
4. **Bank-payout matching** ("paid to the bank") stays approximate until
   step 5's Stripe reconciliation matches payouts to balance transactions.
5. **Preview vs capture:** a preview made before capture may differ by up to
   one cent from the re-quoted capture (rounding); the confirmation copy says
   "about" before capture.

## 14. Extra sessions (step 3) — as built, with the defaults taken

Built 2026-10-28 on `feature/extra-sessions` (migration 0044, seed 0008).
Either side proposes an extra session on a running contract; the other side
confirms explicitly — the family always with "I authorise Poppynz to charge
my card $X" — and silence lapses it. Once agreed it is a dated session
(`contract_sessions.origin = 'extra'`), charged after
`CONTRACT_EXTRA_SESSION_CHARGE_DELAY_MINUTES` (60) during which either side
cancels it for free; then folded into its cycle's charge or charged on its
own payment (`payments.kind = 'contract_extra_session'`). From then on it is
a normal session (cancellations, reports, disputes, refunds on its own
payment, recoveries).

Settings: `CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS` (14),
`CONTRACT_EXTRA_SESSION_CHARGE_DELAY_MINUTES` (60),
`CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS` (7),
`CONTRACT_EXTRA_SESSION_MAX_CHARGE_ATTEMPTS` (15),
`CONTRACT_EXTRA_SESSION_MIN_MINUTES` (15); proposals lapse after
`CONTRACT_REPORT_RESPONSE_HOURS` (48); declined charges retry every
`CONTRACT_BILLING_RETRY_HOURS` (12).

The charge, by the cycle's state when the delay ends:

| Cycle | Charge |
|---|---|
| scheduled, grace (not held yet) | folded into the cycle's charge (`charge_route = cycle`) |
| authorised, re-quote ≤ the hold | folded: the capture is re-quoted |
| authorised, re-quote > the hold | its own off-session charge |
| captured, empty ("Nothing to bill"), carried, suspended, cancelled, capture_failed | its own off-session charge |
| authorising, capturing | waits for the next tick |

Defaults taken while the user was away — each **default (2026-10-28)**:

1. **Folded amount.** The family authorises the extra session priced on its
   own; folded into a cycle the cycle is re-quoted, so the cycle-level
   rounding may move the total by up to a cent per component (the notice
   says "about", like §13.5). Its own charge is always exactly the
   authorised amount.
2. **Never more than authorised.** The authorised amount must equal the
   price now: a family whose price moved (a tax change) is refused with
   "the price changed" and confirms the new amount; a helper accepting a
   family proposal whose price moved is refused the same way. At charge
   time a price above the authorisation is not charged: it waits for an
   admin (`charge_held`, admin email).
3. **Billing must be running.** Proposals are refused while the contract's
   billing is awaiting the helper's payouts, suspended or ended
   (`billing_unavailable`), as well as outside active/ending contracts.
4. **Answering re-checks** the contract, its billing, the service and
   overlaps, but not the lookback or the window: those bound when a
   proposal is made, and an answer within the response window stands.
5. **Overlap.** No overlap with any session of the contract that isn't
   cancelled, nor with an open proposal; touching (one ends as the other
   starts) is fine. Scheduled sessions may still overlap each other. The
   database enforces it (0044 trigger) and one open proposal per slot.
6. **Times.** One day in the contract zone (an end at midnight is allowed),
   at least `CONTRACT_EXTRA_SESSION_MIN_MINUTES` (15) long, at the
   contract's agreed rate for the service. The lookback counts calendar
   days in the contract zone (today − 14 inclusive), floored at the
   contract's start; the window ends at what is materialised (and the
   contract's end, before its end time on the last day).
7. **During the delay** the ordinary session actions (cancel, day off,
   reports, disputes) are not offered on the extra session: its free cancel
   replaces them, so cancelling in the delay is never a late cancellation.
8. **Not charged yet, not charged at all.** An extra session whose session
   is cancelled (a resolution, the contract's end) before its own charge
   succeeded is not charged — no late-cancellation compensation on it
   (family-favourable). A charge in flight is never abandoned; once
   charged, the normal policy applies (refunds on its own payment).
9. **Declines.** The family is emailed on the first decline and when
   automatic retries stop (not on every retry); retries every 12 h up to
   15 attempts (about 7 days), and at once on a new card past the cap. The
   contract's "Retry payment" button is unchanged. Never suspends the
   contract; an extra session charged on its own is never suspended with its
   cycle.
10. **Unpaid alert.** Once, `CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS` after
    it was due: a billing incident (`extra_session_unpaid:<id>`) and an admin
    email; listed under "Unpaid extra sessions" on the admin Payouts page.
11. **Helper pay** comes from the frozen charge row, written only when its
    charge succeeds: the cycle's first transfer when it is still to come
    (also for a cycle never captured), else a follow-up. A transfer whose
    sessions were all charged on one extra payment is sourced from that
    charge when it fits; otherwise the cycle's charge when it fits; else the
    platform balance (§11.1).
12. **Tax report.** An extra charge reports its own frozen lines (both
    sides), dated when charged; its payment row isn't counted again.
13. **Notices.** Both parties are emailed in their own language for every
    event (proposed, withdrawn, declined, lapsed, agreed, cancelled, folded,
    charged, charge failed), with a realtime `contract.extra_session` event.
14. **Permissions.** A new `extraSession` (read, write) for families and
    helpers; the party check is at the route. Admins read the unpaid list
    with `payoutQueue:read`.
15. **Agreement v2** (decision 5). Seed 0008 adds section 5 "Extra
    sessions" (the family authorises charges for extra sessions it confirms
    or proposes, at the contract's rates; the delay; silence lapses) and is
    published only when the live agreement is exactly one English v1 whose
    text is one seed 0007 ever published (no later version, translation or
    draft); anything else is logged and skipped. New placeholders:
    `{{billing.extraSessionDelayMinutes}}`,
    `{{billing.extraSessionLookbackDays}}`,
    `{{billing.extraSessionResponseHours}}`. Existing contracts don't
    re-sign.

Stripe behaviours relied on (all already confirmed in §11.1 or by the
piece 3 work): an off-session PaymentIntent on the saved card with
`capture_method: automatic`; the idempotency key (`extra-<id>-<attempt>`)
replays the same answer within 24 h and refuses other parameters; search by
`metadata.payment_id` is eventually consistent (an unanswered attempt is
replayed, then looked up, never re-sent blind); partial refunds on that
PaymentIntent up to its capture; `source_transaction` transfers capped at
the charge minus refunds minus earlier transfers, else from the platform
balance.
