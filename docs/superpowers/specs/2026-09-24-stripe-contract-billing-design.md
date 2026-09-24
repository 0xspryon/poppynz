# Stripe payments and contract billing — umbrella design

Status: **decisions agreed 2026-09-23/24**. This file records every business
rule settled in the design conversation. Each piece of work below gets its own
detailed spec and plan; where one of those disagrees with this file, update
this file too.

Related: [account deletion notes](2026-09-24-account-deletion-design.md).

## 1. Pieces of work and order

| # | Piece | Contents | Depends on |
|---|---|---|---|
| 1 | Contract dates | Per-contract time zone, `Pacific/Auckland` removed, real elapsed session minutes, start-date rules at send/accept, optional last-day end time | — |
| 2 | Stripe core | Stripe adapter behind `@repo/payments`, saved card + Billing section, webhook with refetch, Credibled checkout on Stripe | — |
| 3 | Contract billing | 3-day cycles, holds/captures, worker, grace period, suspension/resume, commissions, tax table, emails | 1, 2 |
| 4 | Helper payouts | Connect onboarding + nudges, transfers, daily payouts, 60-day manual-payout queue, chargebacks | 3 |
| 5 | Missed sessions | Marking sessions, credits/refunds, admin dispute queue | 3, 4 |

## 2. What already exists

- `@repo/payments` (`packages/payments/src/index.ts`): provider port with
  `quote` / `authorise` / `refund`, mock implementation only. Nothing outside
  the package names Stripe; that rule stays.
- `payments` table (`packages/db/src/schema.ts`): provider-agnostic
  (`provider` + `provider_reference`), itemised amounts frozen at authorisation,
  `kind` enum (`credibled_order` only), status
  `pending → authorised → captured → refunded | failed`, unique index on
  `(provider, provider_reference)` for webhook lookup.
- Guarded state transitions: `CheckOrderRepo.advance` is a single-statement
  compare-and-set (`WHERE status IN (...) AND payment_id IS NOT DISTINCT FROM
  ...`, `RETURNING`); `null` means another writer got there first. New
  payment/cycle state changes follow the same pattern (add a
  `PaymentRepo.advance`).

## 3. Stripe core (piece 2)

- **Embedded Payment Element** (Stripe.js) in the app. Card data never touches
  Poppynz servers; we store brand, last 4 and expiry only.
- **Asynchronous confirmation.** The API creates a PaymentIntent (idempotency
  key = our `payments.id`, `metadata.payment_id` set), returns its
  `client_secret`; the browser confirms (3-D Secure if required). Money is
  marked paid **only** by the server-side settle path, never by the browser
  redirect.
- **Webhook = wake-up signal.** Verify the `Stripe-Signature` over the **raw**
  body (rejects junk, prevents API-call amplification), then **refetch** the
  PaymentIntent from Stripe and act on the fetched object only. Check it
  matches our row (amount, currency, `metadata.payment_id`) before any
  transition. This defends against a leaked webhook secret and against
  duplicate / out-of-order events.
- **One `settle(paymentId)` path** used by the webhook, the reconcile poller
  and the browser return page.
- **Port changes:** `authorise` returns `{ reference, clientSecret, status }`
  rather than a completed authorisation; add hold/capture/cancel operations for
  contract billing; add a way to normalise provider events. The mock mirrors the
  two-step behaviour.
- **Refunds** via Stripe with our idempotency key; confirmed by webhook.

### Cards

- **One card per family** (a Stripe Customer per paying user). Replacing it
  detaches the old card; holds already placed stay on the old card until
  captured or released; new cycles use the new card.
- Cards are collected **in place**: at the KYC check payment (saved for later
  use) and, if none exists, when the family **sends** contract terms. Sending
  is blocked until a card is saved (Stripe SetupIntent verifies it without
  charging).
- A **Billing** section shows the card on file (brand, last 4, expiry) with a
  Replace action.

## 4. Contract dates (piece 1)

- **Per-contract time zone** (IANA name). Derived from the family's location
  when terms are **sent**, **frozen at acceptance**. Sending is blocked if the
  family has no usable location. Province alone is not enough (several
  provinces span two zones; Saskatchewan has no DST).
- The contract zone governs: session times, session lengths, capture time,
  the `ended` presentation, the notice end date, and the send/accept date
  checks — through one shared helper (e.g. `contractToday(contract)`).
- **Everything else is UTC.** Browsers format instants in the viewer's zone.
  `Pacific/Auckland` is removed everywhere.
- Code never attaches a zone to individual date values: calendar dates stay
  zone-less `date` columns, moments are UTC `timestamp` columns, and the zone
  is a single parameter to the functions that convert between them.
- **Real elapsed hours.** A session's billable minutes are the difference
  between its start and end *instants* on that date in the contract zone. On
  DST nights a 01:00–05:00 session bills 3 h (spring) or 5 h (fall). A
  non-existent start time (spring gap) moves forward; an ambiguous time (fall
  overlap) takes the first occurrence.
- **No overnight sessions.** Sessions stay within one day; overnight care is
  two sessions (22:00–24:00 and 00:00–06:00).
- **Start date required at send**, and it must be **later than today** in the
  contract zone. Drafts may leave it empty.
- **Acceptance is refused on or after the start date** — enforced in the API
  route and reflected in the UI ("The start date has passed — ask for new
  terms with a later date").
- **Optional end time on the last day** of a negotiated end date. A contract
  ended by notice (notice + 14 days) works its full scheduled sessions on the
  last day. When both end dates exist, the earlier wins, and the end time
  applies only when the negotiated date is the one that wins.
- Today neither re-accepting while active nor reviving an ended contract is
  possible, so each contract has exactly one billing schedule. If
  re-contracting is added later, it starts a new schedule.

## 5. Contract billing (piece 3)

### Cycles

- **3-day billing cycles** anchored to the contract start date (cycle 1 =
  start date to start date + 2).
- **Hold** the cycle's amount **2 days before the cycle starts**, or
  immediately on acceptance when acceptance is later than that.
- **Capture** at the earlier of **07:00 on the cycle's first day** and **the
  cycle's first session start minus 1 hour** (contract zone).
- **Helper payout** at the end of the cycle (see §6).
- **Partial last cycle:** the amount covers sessions up to the effective end
  date (and end time); captured on the same rule.
- Each cycle stores its `hold_at`, `capture_at` and `payout_at` as **UTC
  instants** computed once from the contract zone. A worker job every
  15 minutes acts on whatever is due (`<= now()`), so a missed run catches up.
- Idempotency: every Stripe hold/capture uses the cycle id as its key.

### Amounts

- A cycle's hours = sum of real elapsed minutes of the sessions whose date
  falls in the cycle (and within the contract's start/end bounds).
- **Commissions, both sides**, stored as env vars in basis points and **frozen
  on the contract at acceptance**:
  - Family: `CONTRACT_FAMILY_COMMISSION_BPS=1000` (10%, added on top).
  - Helper: `CONTRACT_PROVIDER_COMMISSION_BPS=500` (5%, deducted).
  - Stripe processing fees come out of Poppynz's share.
  - Example: $100 of hours → family charged $110, helper receives $95,
    Poppynz keeps $15 minus Stripe fees.
- **Sales tax on the commissions only**, per-province rate table (family's
  province for the family commission, helper's province for the helper
  commission), frozen at acceptance. **Ships at 0%** until an accountant
  confirms rates and obligations.
- Integer cents throughout; rounding rule defined once and shared by holds,
  captures and displays.
- **Below Stripe's CAD $0.50 minimum:** carry the amount into the next cycle;
  if there is no next cycle, Poppynz absorbs it (at most 49¢).

### Declines, suspension and resume

- A hold that fails for a **family card reason** starts a **48-hour grace
  period ending at the cycle start**: notify the family (update your card) and
  the helper (payment pending); retry automatically, and immediately whenever
  the card is replaced.
- Still unsecured at cycle start → the contract is **suspended** (new
  contract state). The helper is told not to work. Days while suspended are
  never billed.
- **Resume:** when the family fixes the card, the prorated rest of the
  current cycle (from now to cycle end or effective end date) is **charged
  immediately** (not held). If the effective end has already passed, nothing
  is charged. Both parties receive an email with the amount and dates.
- Failure caused by **Poppynz or Stripe** (outage, bug): the contract keeps
  running and **Poppynz guarantees that cycle** to the helper while retrying.
  Every guaranteed cycle raises an admin alert.
- Worker catch-up: overdue holds/captures run on the next tick; a capture
  whose hold expired re-charges the saved card; still failing by cycle start
  for platform reasons → the guarantee applies.

## 6. Helper payouts (piece 4)

- **Stripe Connect** with **separate charges and transfers**: Poppynz charges
  the family, then transfers the helper's share. Transfers carry
  `source_transaction` so Stripe waits for the charge's funds to settle.
- Helpers' Stripe accounts use **daily automatic payouts** (one bank payout
  per day across all their contracts).
- **Payout account not required to accept.** At acceptance the helper is
  nudged ("you'll need a payout account to collect your money — set it up now
  or later"); at payout time they are asked firmly (email + in-app,
  reminders). Funds wait in the Poppynz balance meanwhile and are transferred
  in one go once the account is verified.
- **60 days** without an account → the payout goes to an **admin queue for a
  manual payout** (Stripe allows holding funds up to 90 days for Canada).
- **Manual (off-Stripe) payout — admin only, force majeure:** the admin
  records amount, method (e.g. Interac e-Transfer), reference and reason; the
  cycle payout is marked settled so it can never also go through Stripe;
  audited.
- A restricted Connect account mid-contract only delays that helper's
  payouts; the contract continues.
- **Chargebacks:** Poppynz absorbs them (amount + ~$15 fee), contests with
  evidence (signed contract, sessions, cycle records), and suspends the
  family's contracts until resolved. Never clawed back from the helper.
- Paying helpers faster than Stripe settlement (Poppynz fronting funds) is a
  **business decision deferred**.

## 7. Missed sessions (piece 5)

- Until a cycle's payout, either party can mark a session as missed and say
  whose side caused it.
- **Helper-caused** → a **credit** on the family's next cycle; **refund** if
  there is no next cycle.
- **Family-caused** → still paid to the helper.
- **Disagreement** → that session's share of the payout is held back and goes
  to an **admin queue**; the rest of the cycle pays out normally.
- After payout the cycle is final.
- **Statutory holidays:** no special handling; the missed-session flow covers
  days off.

## 8. Data rules

- No hard deletes of users. Money-related tables (`payments`, cycles,
  payouts, adjustments, and the contracts they point at) use `restrict`
  foreign keys; account deletion anonymises instead and is blocked while money
  is in flight. Full design deferred — see the account-deletion notes.

## 9. To verify before or during implementation

- **Accountant:** GST/HST/PST/QST on the commissions; whether childcare /
  personal-care hours are exempt; whether the CRA reporting rules for digital
  platform operators (since 2024) apply — if so, collect helper tax details
  (SIN or business number) and file annually.
- **Stripe:** exact error when transferring to an account whose `transfers`
  capability is inactive (Transfers API reference); Canadian settlement timing
  (docs summary said 3 business days, 7 days for the first payout).

## 10. Stripe facts relied on (checked 2026-09-23/24)

- Card hold validity, online payments: Visa **4 days 18 h** for
  merchant-initiated (saved-card) holds, 7 days customer-initiated;
  Mastercard / Amex / Discover 7 days. The real deadline per charge is
  `payment_method_details.card.capture_before`. An expired hold is released
  and the PaymentIntent becomes `canceled`.
- Extended authorisation (up to 30 days) needs IC+ pricing and, on Visa,
  applies only to customer-initiated transactions — not usable for our
  off-session holds.
- Partial capture releases the remainder; only one capture per authorisation;
  capturing more than held is limited (overcapture).
- Connect pricing (Canada, "you handle pricing"): CA$2 per monthly active
  account, 0.25% + CA$0.25 per payout; card processing from 2.9% + CA$0.30.
  No fee for holding funds or per transfer.
- Funds may be held for a connected account up to **90 days** (Canada falls
  under "all other countries").
- Minimum charge CAD $0.50.
