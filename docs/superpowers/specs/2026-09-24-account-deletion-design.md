# Account deletion — design notes (not yet designed)

Status: **placeholder**. Decisions below were agreed on 2026-09-24 while
designing contract billing (Stripe). The full design — brainstorm, spec, plan —
happens in its own round. Nothing here is implemented yet.

## Agreed

- **Deleting an account never hard-deletes rows.** It anonymises the account
  and keeps everything else.
  - `user.email` becomes `deleted_<uuidv7>@account.poppynz`.
  - The user's location is replaced with a predefined placeholder location.
  - `deletedAt` is set to `now()` where the table has one. The `user` table has
    no `deleted_at` column today, so one needs to be added.
  - Payments, contracts, cycles, payouts, messages and every other record stay
    intact. A helper's payment history must never disappear because the
    family deleted their account, and the same goes the other way round.
- **Foreign keys to `user.id` change from `onDelete: 'cascade'` to
  `restrict`** (see the list below), so the database refuses any hard delete
  that would take records with it.
- **Deletion is refused while money is in flight.** That covers an active or
  ending contract, a billing cycle not yet settled, a helper payout not yet
  transferred, or an open check order or payment. The user sees why ("End your
  contract first"), never a database error.

## Open questions for the design round

- Which other personal data is scrubbed: names, phone numbers, profile photo,
  bio, addresses, coordinates, search-index documents (Typesense
  families/providers), user searches, referral codes.
- **KYC evidence** (`kyc_documents`, `safety_verifications`, uploaded ID and
  vulnerable-sector check files): keep or delete? This depends on PIPEDA and
  Quebec's Law 25 retention rules versus the evidence needed for disputes and
  chargebacks.
- Messages: keep the text and show the author as "Deleted user"?
- Auth: revoke sessions, remove OAuth `account` rows, stop magic-link sign-in
  for the anonymised email.
- Stripe: detach the family's saved card and keep the Customer (for records);
  what happens to a helper's Connect account and to payouts still owed to them.
- Can an anonymised account be restored, and within what window?
- Admin-initiated deletion versus self-service deletion.

## Foreign keys that currently cascade

From `packages/db/src/schema.ts` on 2026-09-24. Every `user.id` reference
below needs a `restrict` / keep decision; the child-table cascades (e.g.
`contract_versions -> contracts`) are fine only while their parent can no
longer be hard-deleted.

| Table | References |
|---|---|
| `account`, `session` | `user.id` |
| `user_profile` | `user.id` |
| `approval_requests`, `approvals` | `user.id` |
| `check_orders` | `user.id` |
| `check_order_items` | `check_orders.id` |
| `payments` | `user.id` |
| `kyc_documents`, `safety_verifications` | `user.id` |
| `conversations` (3 columns) | `user.id` |
| `conversation_messages` | `user.id`, `conversations.id` |
| `contracts` (family, provider) | `user.id`, `conversations.id` |
| `contract_versions` | `user.id`, `contracts.id` |
| `services_needed`, `services_offered` | `user.id` |
| `referral` | `user.id` |
| `tc_document_acceptances` | `user.id` |
| `user_search` | `user.id` |
| `family_search_outbox`, `provider_search_outbox` | `user.id` |
| `member`, `invitation` | `user.id`, `organization.id` |

The contract-billing work adds tables (cycles, payouts, session adjustments)
that reference `user.id`, `contracts.id` and `payments.id`. Those are created
with `restrict` from the start.
