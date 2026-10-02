# Stripe payments and contract billing — umbrella design

Status: **decisions agreed 2026-09-23/24, revised 2026-10-02 with the
founder's decisions** ("Poppynz Payments and Cancellation Rules", reviewed
from the executive summary). This file records every business rule settled so
far. Each piece of work below gets its own detailed spec and plan; where one of
those disagrees with this file, update this file too.

Related: [account deletion notes](2026-09-24-account-deletion-design.md),
[piece 1 spec](2026-09-24-contract-dates-design.md).

## 1. Pieces of work and order

| # | Piece | Contents | Depends on |
|---|---|---|---|
| 1 | Contract dates | Per-contract time zone, `Pacific/Auckland` removed, real elapsed session minutes, start-date rules at send/accept, optional last-day end time | — |
| 2 | Stripe core | Stripe adapter behind `@repo/payments`, saved card + Billing section, webhook with refetch, Credibled checkout on Stripe, **helper Connect onboarding with identity, bank and capability checks** | — |
| 3 | Contract billing | Session records (rolling 14-day window), 3-day cycles, holds/captures, charge gate, payment-readiness gate, worker, grace period, suspension/resume, commissions, configurable tax, ledger, notices | 1, 2 |
| 4 | Helper payouts | End-of-cycle transfers (+48 h), payout monitoring, exceptional manual-payout queue, card disputes and transfer reversals | 2, 3 |
| 5 | Session resolution | In-app cancellation with timestamps, 24-hour cancellation policy, missed sessions, agreed schedule changes, credits and refunds, admin dispute queue | 3, 4 |

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
  payment/cycle/session state changes follow the same pattern (add a
  `PaymentRepo.advance`).
- Contracts can't be amended once accepted, and an ended contract can't be
  revived — so each contract has exactly one billing schedule. If
  re-contracting is added later, it starts a new schedule.

## 3. Stripe core (piece 2)

- **Embedded Payment Element** (Stripe.js) in the app. Card data never touches
  Poppynz servers; we store brand, last 4 and expiry only.
- **Asynchronous confirmation.** The API creates a PaymentIntent (idempotency
  key = our `payments.id`, `metadata.payment_id` set), returns its
  `client_secret`; the browser confirms (3-D Secure if required). Money is
  marked paid **only** by the server-side settle path, never by the browser
  redirect.
- **Webhook = wake-up signal.** Verify the `Stripe-Signature` over the **raw**
  body, then **refetch** the PaymentIntent from Stripe and act on the fetched
  object only, after checking it matches our row (amount, currency,
  `metadata.payment_id`). Defends against a leaked webhook secret and against
  duplicate / out-of-order events.
- **One `settle(paymentId)` path** used by the webhook, the reconcile poller
  and the browser return page.
- **Port changes:** `authorise` returns `{ reference, clientSecret, status }`;
  add hold/capture/cancel operations for contract billing; add a way to
  normalise provider events. The mock mirrors the two-step behaviour.
- **Refunds** via Stripe with our idempotency key; confirmed by webhook.
- **Verify in test mode before launch** (founder): authorisation and capture
  windows, Connect capabilities and payout timing, partial capture and refund
  handling, card disputes and transfer-reversal permissions.

### Cards

- **One card per family** (a Stripe Customer per paying user). Replacing it
  detaches the old card; holds already placed stay on the old card; new cycles
  use the new card.
- Collected **in place**: at the KYC check payment (saved for later) and, if
  none exists, when the family **sends** contract terms. Sending is blocked
  without a valid payment method (SetupIntent verifies it without charging).
  A successful card check does **not** guarantee later authorisations: every
  cycle must still be funded before care starts.
- A **Billing** section shows the card on file with a Replace action.

### Helper Connect onboarding (moved here from piece 4)

- **Payment-ready** = Connect onboarding complete, required identity
  verification done, an eligible bank payout method, and the transfer/payout
  capabilities active.
- A helper may create a profile, be vetted, receive referrals, interview and
  discuss terms before setting up Connect. The onboarding prompt appears
  before an offer can become an active paid contract.

## 4. Contract dates (piece 1)

Unchanged by the founder review. Full detail in the
[piece 1 spec](2026-09-24-contract-dates-design.md).

- **Per-contract time zone** (IANA name) from the family's location when terms
  are **sent**, **frozen at acceptance**. Sending is blocked without a usable
  family location. Everything else in the app is UTC.
- **Real elapsed hours**: on DST nights a 01:00–05:00 session is 3 h (spring)
  or 5 h (fall). A non-existent wall time moves to the moment the clock
  resumes; an ambiguous one takes its first occurrence.
- **No overnight sessions** (two sessions instead).
- **Start date required at send and later than today**; **acceptance refused
  on or after the start date**.
- **Optional last-day end time** on a negotiated end date; sessions that day
  are cut at it. A contract ended by notice works its full schedule on the
  last day.
- **The 2-week notice stays.** The notice end date is the notice day plus 14
  calendar days in the contract zone. Sessions inside the notice period follow
  the 24-hour cancellation rule individually (§7).

## 5. Session records (piece 3)

Every rule from here on works per **dated session**, so the app gets a
session record — one row per contract, date and time slot — created from the
accepted weekly pattern.

- A worker job (the 15-minute tick) **materialises sessions on a rolling
  14-day window** (the notice period). It is idempotent: a unique key on
  `(contract, date, slot)` means rerunning never duplicates.
- Each session stores its date, wall-clock start/end, the **real elapsed
  minutes** in the contract zone (DST applied once, at creation), its status
  (`scheduled → completed | cancelled | disputed`, plus suspended), and its
  ledger entries.
- **Cancellations, agreed schedule changes and disputes act on session
  records.** Sessions beyond the window don't exist yet and pick up the
  pattern automatically when created — so a later change only ever touches
  sessions already materialised.
- An agreed schedule change can therefore only move sessions within the next
  14 days; the 24-hour cutoff always falls inside that window.
- A cycle's amount is the sum of its sessions. A change after the hold reduces
  what is captured; after capture it becomes a credit or refund (§7).
- **Ledger:** every cycle, session, fee, credit and refund is recorded as its
  own entry.

## 6. Contract billing (piece 3)

### Cycles

- **3-day rolling cycles** anchored to the contract start date.
- **Hold** the cycle's amount **2 days before the cycle starts**.
- **Capture** at the earlier of **07:00 on the cycle's first day** and **the
  cycle's first session start minus 1 hour** (contract zone).
- **Charge gate:** no scheduled care begins without a successful charge,
  except under the system-failure procedure below.
- **Late bookings:** a contract accepted less than 2 days before its first
  session is authorised **and captured as soon as it becomes binding**, before
  care begins. There is no 48-hour card-update period. If funding fails, the
  first session is not activated.
- **Partial last cycle:** covers sessions up to the effective end date (and
  end time); captured on the same rule.
- Each cycle stores `hold_at`, `capture_at` and `transfer_at` as **UTC
  instants** computed once from the contract zone; the 15-minute worker acts
  on whatever is due, so a missed run catches up. Every Stripe hold/capture
  uses the cycle id as its idempotency key.
- **Before each cycle starts**, recheck the family's successful capture and
  the helper's Connect status; notify both parties if either fails. A helper
  is never told to work a suspended cycle.

### Amounts and fees

- A cycle's service value = the sum of its sessions' real elapsed hours ×
  the agreed rate.
- **Commissions** (founder, approved for this build), env vars in basis
  points, **frozen on the contract at acceptance**:
  - Family service fee: `CONTRACT_FAMILY_COMMISSION_BPS=500` (**5%**, added on
    top).
  - Helper commission: `CONTRACT_PROVIDER_COMMISSION_BPS=1500` (**15%**,
    deducted).
  - Poppynz gross revenue = 20% of service value, before Stripe processing and
    payout costs, taxes, credits and refunds. Stripe costs come out of it.
  - Example: $600 of service → family charged $630, helper receives $510,
    Poppynz grosses $120 (≈ $99.90 after illustrative Stripe fees).
  - Use the account's live Stripe pricing; the figures in §11 are
    illustrative.
- **Tax:** build **configurable tax treatment per supply type** — the family
  fee, the helper commission and cancellation compensation — by jurisdiction.
  Do not assume they share a treatment. **No taxable charge goes live at a
  default 0% without the accountant's written sign-off.**
- Integer cents throughout; one rounding rule shared by holds, captures and
  displays.
- **Below Stripe's CAD $0.50 minimum:** carry into the next cycle; with no
  next cycle Poppynz absorbs it (at most 49¢).

### Declines, suspension and resume

- A hold that fails for a **family card reason** starts a **48-hour grace
  period ending at the cycle start**: notify the family (update your card) and
  the helper (payment pending); retry automatically, and immediately whenever
  the card is replaced.
- Still unfunded at cycle start → the contract is **suspended**; the helper is
  told not to work; days while suspended are never billed.
- **Resume:** when the family fixes the card, the prorated rest of the current
  cycle is **charged immediately** (not held). If the effective end has
  passed, nothing is charged. Both parties get an email with the amount and
  dates.
- **Poppynz or Stripe failure** after a cycle was represented as funded:
  alert an admin immediately; **Poppynz funds the helper's completed
  sessions** in the affected cycle while attempting recovery from the family;
  the loss is never shifted to the helper. Document the incident and **prevent
  new unfunded cycles from starting**.

### Payment-readiness gate

- A contract accepted while the helper isn't payment-ready becomes **pending
  payment readiness**; its start is blocked.
- Reminders to the helper at acceptance and 7, 3 and 1 day before the start
  date; the family is copied from the 3-day reminder.
- **No hold is placed on the family's card** while the helper isn't ready.
- Deadline = the cycle-1 capture time. Still not ready → the contract is
  **cancelled**, nothing has been charged, both parties are notified.

## 7. Session resolution (piece 5)

### Cancellation policy (founder, approved)

Applied **per session**. The cutoff is measured from the session's scheduled
start in the contract zone.

| Situation | Helper | Family |
|---|---|---|
| Helper cancels or doesn't show | $0 | Full unused service value **and** family fee back, as credit or refund to the original card |
| Family cancels ≥ 24 h before the start | $0 | Full credit or refund, including the 5% family fee |
| Family cancels < 24 h before (incl. no-show, early dismissal, family-requested reduction of hours) | **25%** of the cancelled session's base service value; time actually worked is paid at the agreed rate | Pays that 25%; the other 75% and the whole family fee are released, credited or refunded |
| Parties disagree | Admin investigates; only that session's transfer is held | — |

- **Poppynz retains no fee or commission on a cancelled session.**
- "At least 24 hours" = cancellation recorded no later than the instant 24 h
  before the session starts; exactly 24 h is timely.
- Example: a $200 session with a $10 family fee. Timely family cancellation →
  family gets $210 back, helper $0. Late family cancellation → helper $50,
  family gets $160 back, Poppynz $0.
- **Cancellations are recorded in the app only**, timestamped in the contract
  zone, with a timestamped confirmation to both parties. Messages or calls
  don't count until recorded. Support may correct the timestamp with evidence
  the app was unavailable.
- Show the itemised amounts to both sides before confirming a cancellation.
- **Ending the contract** (2-week notice) stops future unstarted sessions;
  any session inside the notice window still follows the 24-hour rule.
- A **mutually agreed schedule change recorded before the cutoff** removes or
  reschedules a session without a fee (§5: within the 14-day window).
- **Statutory holidays** follow the accepted schedule and the same notice
  rule.
- After a helper cancellation, an admin may help find a replacement, but the
  family must approve the new booking and price; no automatic substitution.
- A verified Poppynz/Stripe outage is handled under §6, never as a family
  cancellation.
- Support overrides require a recorded reason, user notification and an audit
  log.

### Reports, refunds and credits

- Either party can report a missed, cancelled or disputed session **for 48 h
  after its scheduled end**; support can review later reports, and statutory
  rights are unaffected.
- A valid refund: the family chooses a **credit on a future cycle or a refund
  to the original payment method**. Never force an expiring credit in place of
  a required refund. Before capture, release or reduce the authorisation
  instead of refunding.

## 8. Helper payouts (piece 4)

- **Stripe Connect, separate charges and transfers.** Transfers carry
  `source_transaction` so Stripe waits for the charge's funds.
- **Transfer timing:** each cycle's transfer is initiated **48 h after the
  cycle ends**, once every session in it is past its report window. Only
  reported, disputed session amounts are held back. The helper sees copy
  explaining why (e.g. "Paid 2 days after each cycle, so either side can
  report a problem with a session first").
- Helpers keep Stripe's **standard payout schedule** (daily, one bank payout
  across all contracts). Funding faster payouts from Poppynz cash is **not
  approved** for this build.
- A Connect account **restricted mid-contract**: hold that helper's transfers
  for admin review, notify them of the steps required, don't promise a bank
  arrival date, and have the admin decide whether care can continue safely.
  Never keep booking sessions with no viable payment route.
- **Earned amounts that can't be sent** through Connect: alert an admin
  promptly; at **60 days**, escalate for a documented **manual payment
  review** (e.g. Interac e-Transfer), verifying the recipient and the Stripe
  and legal requirements first. Do not assume a 90-day Canadian limit without
  confirming it for this account configuration.
- **Manual payouts** are an admin-only exception: the admin records amount,
  method, reference and reason; the payout is marked settled so it can never
  also go through Stripe; every one is logged.

## 9. Card disputes (piece 4)

- Stripe debits the Poppynz balance during a dispute and may charge a fee. The
  issuer decides the outcome; a reversal goes to the original card. Poppynz
  can't redirect it or automatically re-charge the family.
- Submit evidence through Stripe: the accepted contract and cancellation
  terms, session and notice timestamps, the funding record, messages, work
  confirmation, prior refunds and admin decisions. Prevent duplicate refunds
  while a dispute is open.
- Flag the payment for admin review. **Suspend future cycles only if the
  payment method is no longer reliable or there is evidence of fraud**; notify
  both parties; never retroactively stop paying an undisputed completed
  session.
- **A lost dispute:** Poppynz bears the Stripe debit. Review the cause —
  Poppynz absorbs processing or system errors; **if the helper did not provide
  the service, use a transfer reversal or recovery where permitted**, with
  notice and an audit trail. No blanket guarantee that a helper keeps payment
  for a session they didn't provide.

## 10. Data rules

- No hard deletes of users. Money-related tables (`payments`, sessions,
  cycles, transfers, ledger, and the contracts they point at) use `restrict`
  foreign keys. Account closure is a request: outstanding balances and open
  contracts are resolved first, then the retention and deletion policy applies.
  Full design deferred — see the account-deletion notes.

## 11. Stripe facts relied on (checked 2026-09-23/24; verify in test mode)

- Card hold validity, online payments: Visa **4 days 18 h** for
  merchant-initiated (saved-card) holds, 7 days customer-initiated;
  Mastercard / Amex / Discover 7 days. The real deadline per charge is
  `payment_method_details.card.capture_before`. An expired hold is released
  and the PaymentIntent becomes `canceled`.
- Extended authorisation (up to 30 days) needs IC+ pricing and, on Visa,
  applies only to customer-initiated transactions.
- Partial capture releases the remainder; one capture per authorisation;
  capturing more than held is limited.
- Connect pricing (Canada, platform sets pricing): CA$2 per monthly active
  account, 0.25% + CA$0.25 per payout; card processing from 2.9% + CA$0.30;
  no fee for holding funds or per transfer.
- Holding funds for a connected account: Stripe's docs list 90 days for
  "all other countries"; **unconfirmed for our account** (founder).
- Minimum charge CAD $0.50.

## 12. Open items

**Launch checks (founder):**
- Accountant: GST/HST/PST/QST on the family fee, the helper commission and
  cancellation compensation (jurisdiction, registration); whether childcare
  and personal-care hours are exempt; whether the CRA reporting rules for
  digital platform operators (since 2024) apply — if so, collect helper tax
  details (SIN or business number) and file annually.
- Stripe test mode: the verifications listed in §3.

**Open business decisions (founder):**
- One all-in price for families, or an itemised service fee.
- Whether a future release funds accelerated payouts from Poppynz cash.
