# Helper Vouches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a helper applicant ask approved Poppynz members to vouch for them, show those vouches (and a free-text "General remarks" field) to admins on the approval request, and close two approval-gate gaps (reach-out recipient, contract counterpart).

**Architecture:** One new `vouches` table, written by three actors: the applicant (requests), the voucher (accept with answers / decline / withdraw), and admins (flag / revoke). Whether a vouch *counts* is never stored. It's derived at read time by one pure module (`apps/api/src/lib/vouches.ts`) from the row plus the voucher's current standing (not banned, verified email, live approval). So a voucher losing standing stops counting immediately, with no job. Vouches are a **nudge, not a gate**: approval logic is unchanged. Applicants are told 2 vouches are recommended, and admins see a "Needs a chat" filter.

**Tech Stack:** Bun + Hono + Effect (api), Drizzle on Postgres (hand-written SQL migrations), SvelteKit 5 runes + Tailwind v4/daisyUI (web), vitest, `@repo/mail`, `@repo/notify` (SSE).

**Spec:** this conversation's agreed scope (no separate spec file). Summary of decisions:
- Statuses stored: `pending | accepted | declined | revoked | flagged`. `expired` is derived (`pending` past `expires_at`). No `ADMIN_VERIFIED`.
- Only helpers (`service-provider`) request vouches. Families and helpers can vouch, and **both must hold a live approval**, plus not banned and a verified email. No phone checks.
- 2 vouches from 2 different users are *recommended*; submitting an approval request with fewer is allowed (soft warning). Admin then emails off-app to arrange a chat.
- No interview management. The approval request gets a **General remarks** field (placeholder `Notes from the interview`).
- Admin queue gets a "Vouches" filter row: All · Needs a chat · Vouched · Concerns.
- Reach-out must also check the **recipient's** live approval; contract send/accept must check both sides.

## Global Constraints

- Migrations are **hand-written**: `packages/db/src/migrations/NNNN_name.sql` + a hand-added entry in `meta/_journal.json`. Never run `bun db:generate:migrations`.
- Effect error mapping style: `repo.call().pipe((errors) => mapXRepoError(errors))` or `Effect.mapError(...)`, matching the file being edited.
- Hono response mappers must be generic (`<T extends {...}>`), never `any`, or the web RPC types collapse.
- After changing API routes, run `bun run build` in `apps/api` before type-checking `apps/web` (web types come from `apps/api/dist`).
- Use shared UI pieces (`ConfirmDialog`, `StatusChip`, daisyUI `modal`), not hand-rolled equivalents.
- Svelte: `$state<T | null>(null)`, not `let x: T | null = $state(null)`, before top-level `$derived` reads.
- Vouch answers and admin reasons are **admin-only**. They never appear in an applicant or public response.
- Copy: the admin field label is exactly `General remarks`, placeholder exactly `Notes from the interview`.
- Recommended vouch count is the constant `RECOMMENDED_VOUCHES = 2`; request expiry `vouchRequestTtlMs = 14 days`. Both live in `apps/api/src/lib/constants.ts`.

**Working location:** create a worktree `vouches` on branch `feature/helper-vouches` from `develop` (superpowers:using-git-worktrees). Copy `apps/api/.env` and `apps/worker/.env` from `develop/`, and `mkdir bun_node_modules` before `docker compose up`.

**Test commands:** API unit tests run from `apps/api`: `bunx vitest run <path>`. Web: `cd apps/web && bun run check` (svelte-check) and `bun run lint`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/migrations/0023_vouches.sql` (create) | `vouch_status` enum, `vouches` table, `approval_requests.general_remarks*` columns |
| `packages/db/src/migrations/meta/_journal.json` (modify) | journal entry idx 23 |
| `packages/db/src/schema.ts` (modify) | `vouchStatus`, `VouchAnswers`, `vouch` table, approval-request columns |
| `packages/db/src/repos/vouch-repo.ts` (create) | `VouchRepo` tag, live layer, test helpers |
| `packages/db/src/repos/approval-request-repo.ts` (modify) | `updateGeneralRemarks` |
| `packages/db/src/index.ts` (modify) | export vouch repo |
| `apps/api/src/lib/constants.ts` (modify) | `RECOMMENDED_VOUCHES`, `vouchRequestTtlMs` |
| `apps/api/src/lib/vouches.ts` (create) | pure rules: presented status, can-vouch, counts, summary, applicant-facing status |
| `apps/api/src/lib/approval-gate.ts` (modify) | `requireCounterpartApproval`, `CounterpartNotApprovedError` |
| `apps/api/src/lib/auth-roles.ts` (modify) | `vouch` resource + grants |
| `packages/mail/src/templates.ts`, `packages/mail/src/mailer.ts` (modify) | `vouchRequestMail`, `sendVouchRequest` |
| `packages/notify/src/events.ts` (modify) | `vouch.requested`, `vouch.updated` |
| `apps/api/src/routes/app/vouches/vouches.validator.ts` (create) | request/submit/admin-action schemas |
| `apps/api/src/routes/app/vouches/vouches.handler.ts` (create) | applicant, voucher and admin programs + error mapping |
| `apps/api/src/routes/app/vouches/vouches.ts` (create) | `/vouches` routes |
| `apps/api/src/routes/app/admin/vouches.ts` (create) | `/admin/vouches` routes |
| `apps/api/src/routes/app/vouches/vouches.unit.test.ts` (create) | program tests |
| `apps/api/src/routes/app/approval-requests/*` (modify) | queue summary, detail vouches + remarks, remarks endpoint |
| `apps/api/src/routes/app/conversations/conversations.handler.ts` (modify) | recipient approval check |
| `apps/api/src/routes/app/contracts/contracts.handler.ts` (modify) | own + counterpart approval on create/send/accept |
| `apps/api/src/managed-runtime.ts`, `apps/api/src/app-env.ts`, `apps/api/src/routes/app/index.ts` (modify) | wiring |
| `apps/web/src/lib/api/vouches.ts` (create) | web RPC client |
| `apps/web/src/lib/components/vouches/ApplicantVouchesPanel.svelte` (create) | helper's request form + status list |
| `apps/web/src/lib/components/vouches/VouchRequestsPage.svelte` (create) | voucher inbox |
| `apps/web/src/lib/components/vouches/VouchFormDialog.svelte` (create) | 6 questions + attestation |
| `apps/web/src/routes/{family,service-provider}/vouches/+page.svelte` (create) | page shells |
| `apps/web/src/routes/service-provider/verification/+page.svelte` (modify) | vouches section + count to ApprovalPanel |
| `apps/web/src/lib/components/verification/ApprovalPanel.svelte` (modify) | soft nudge on submit |
| `apps/web/src/lib/components/admin/VouchesCard.svelte`, `GeneralRemarksCard.svelte`, `VouchActionDialog.svelte` (create) | admin detail sections |
| `apps/web/src/lib/api/admin-approvals.ts` (modify) | remarks + vouch admin calls |
| `apps/web/src/routes/admin/approval-requests/+page.svelte`, `[id]/+page.svelte` (modify) | filter row, badges, new cards |
| `apps/web/src/lib/components/RealtimeNotifications.svelte`, the two `+layout.svelte` (modify) | toasts, nav |

---

### Task 1: Schema, migration and `VouchRepo`

**Files:**
- Create: `packages/db/src/migrations/0023_vouches.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema.ts` (after the `referral` table, ~line 224; `approvalRequest` ~line 266)
- Create: `packages/db/src/repos/vouch-repo.ts`
- Modify: `packages/db/src/repos/approval-request-repo.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces: `vouch` table, `VouchStatus`, `VouchAnswers`, `Vouch`, `VoucherStanding`, `VouchWithVoucher`, `VouchWithApplicant`, `VouchRepo` (`create`, `findById`, `findOpenByPair`, `listForApplicants`, `listForVoucher`, `transition`), `makeVouchRepoTest`, `EmptyVouchRepoTest`, `dummyVouch`; `ApprovalRequestRepo.updateGeneralRemarks(id, remarks, updatedBy)`.

- [ ] **Step 1: Write the migration**

`packages/db/src/migrations/0023_vouches.sql`:

```sql
-- Vouches: an approved member endorses a helper applicant. A nudge, not a
-- gate — approval never reads this table. Whether a vouch COUNTS is derived at
-- read time from the row plus the voucher's current standing, so nothing here
-- stores "counted" or "expired".
CREATE TYPE "app_db"."vouch_status" AS ENUM('pending', 'accepted', 'declined', 'revoked', 'flagged');--> statement-breakpoint
CREATE TABLE "app_db"."vouches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"applicant_user_id" text NOT NULL,
	"voucher_user_id" text NOT NULL,
	"voucher_role" "app_db"."access_control_role" NOT NULL,
	"relationship" text NOT NULL,
	"status" "app_db"."vouch_status" DEFAULT 'pending' NOT NULL,
	"answers" jsonb,
	"attested_at" timestamp,
	"submitted_ip" text,
	"expires_at" timestamp NOT NULL,
	"decided_at" timestamp,
	"revoked_by" text,
	"admin_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."vouches" ADD CONSTRAINT "vouches_applicant_user_id_user_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."vouches" ADD CONSTRAINT "vouches_voucher_user_id_user_id_fk" FOREIGN KEY ("voucher_user_id") REFERENCES "app_db"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_db"."vouches" ADD CONSTRAINT "vouches_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "app_db"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vouches_applicant_user_id_idx" ON "app_db"."vouches" USING btree ("applicant_user_id");--> statement-breakpoint
CREATE INDEX "vouches_voucher_user_id_idx" ON "app_db"."vouches" USING btree ("voucher_user_id");--> statement-breakpoint
-- One person fills one slot: at most one accepted vouch per pair.
CREATE UNIQUE INDEX "vouches_pair_accepted_uidx" ON "app_db"."vouches" USING btree ("applicant_user_id", "voucher_user_id") WHERE "status" = 'accepted';--> statement-breakpoint
ALTER TABLE "app_db"."approval_requests"
  ADD COLUMN "general_remarks" text,
  ADD COLUMN "general_remarks_updated_by" text,
  ADD COLUMN "general_remarks_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "app_db"."approval_requests" ADD CONSTRAINT "approval_requests_general_remarks_updated_by_user_id_fk" FOREIGN KEY ("general_remarks_updated_by") REFERENCES "app_db"."user"("id") ON DELETE set null ON UPDATE no action;
```

- [ ] **Step 2: Add the journal entry**

In `packages/db/src/migrations/meta/_journal.json`, append to `entries` (after idx 22):

```json
{"idx": 23, "version": "7", "when": 1788140000000, "tag": "0023_vouches", "breakpoints": true}
```

Before committing, run `ls ../contract-dates/packages/db/src/migrations` from the worktree root. If another branch has claimed `0023`, renumber this migration and tell the user.

- [ ] **Step 3: Add the Drizzle schema**

In `packages/db/src/schema.ts`, add after `checkOrderOutcome` (the enums block):

```ts
// A vouch's own lifecycle. `expired` is not stored — a pending row past
// expires_at presents as expired at read time, like referrals.
export const vouchStatus = appDb.enum('vouch_status', [
  'pending',
  'accepted',
  'declined',
  'revoked',
  'flagged'
]);
```

Add after the `referral` table:

```ts
/** The voucher's answers to the six-question form. Admin-only, always. */
export type VouchAnswers = {
  howKnow: string;
  howLong: string;
  wouldTrust: 'yes' | 'no' | 'unsure';
  hasConcerns: boolean;
  concernsDetail: string | null;
  wouldHire: 'yes' | 'no' | 'unsure';
  anythingElse: string | null;
};

// An approved member endorsing a helper applicant. Approval never reads this
// table — vouches inform the admin and nudge the applicant, nothing more.
export const vouch = appDb.table(
  'vouches',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    applicantUserId: text('applicant_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    voucherUserId: text('voucher_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // The voucher's role when asked — a later role change doesn't rewrite history.
    voucherRole: accessControlRole('voucher_role').notNull(),
    // The applicant's own description of how they know the voucher.
    relationship: text('relationship').notNull(),
    status: vouchStatus('status').notNull().default('pending'),
    answers: jsonb('answers').$type<VouchAnswers>(),
    attestedAt: timestamp('attested_at'),
    submittedIp: text('submitted_ip'),
    expiresAt: timestamp('expires_at').notNull(),
    decidedAt: timestamp('decided_at'),
    // Who revoked or flagged it: the voucher withdrawing, or an admin.
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
    adminReason: text('admin_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index('vouches_applicant_user_id_idx').on(table.applicantUserId),
    index('vouches_voucher_user_id_idx').on(table.voucherUserId),
    uniqueIndex('vouches_pair_accepted_uidx')
      .on(table.applicantUserId, table.voucherUserId)
      .where(sql`${table.status} = 'accepted'`)
  ]
);
```

In the `approvalRequest` table, add after `reason`:

```ts
    // Admin-only free text, typically notes from an off-app chat with the
    // applicant. Never shown to the applicant.
    generalRemarks: text('general_remarks'),
    generalRemarksUpdatedBy: text('general_remarks_updated_by').references(() => user.id, {
      onDelete: 'set null'
    }),
    generalRemarksUpdatedAt: timestamp('general_remarks_updated_at'),
```

- [ ] **Step 4: Write `VouchRepo`**

`packages/db/src/repos/vouch-repo.ts`:

```ts
import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  type InferInsertModel,
  type InferSelectModel,
  or
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { approval, user, userProfile, vouch } from '../schema';

export type Vouch = InferSelectModel<typeof vouch>;
export type NewVouch = InferInsertModel<typeof vouch>;
export type VouchStatus = Vouch['status'];

/** What decides whether a voucher's word counts right now. */
export type VoucherStanding = {
  banned: boolean | null;
  banExpires: Date | null;
  emailVerified: boolean;
  hasLiveApproval: boolean;
};

export type VouchWithVoucher = Vouch & {
  voucher: VoucherStanding & {
    name: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
};

export type VouchWithApplicant = Vouch & {
  applicant: { name: string; firstName: string | null; lastName: string | null; image: string | null };
};

export type VouchTransition = {
  id: string;
  /** The update only applies while the row is in one of these statuses. */
  from: ReadonlyArray<VouchStatus>;
  /** Also require expires_at > now — for actions on a pending request. */
  notExpired?: boolean;
  /** When set, the row must belong to this voucher. */
  voucherUserId?: string;
  set: Partial<
    Pick<
      NewVouch,
      'status' | 'answers' | 'attestedAt' | 'submittedIp' | 'decidedAt' | 'revokedBy' | 'adminReason'
    >
  >;
};

export class VouchRepo extends Context.Tag('@repo/db/VouchRepo')<
  VouchRepo,
  {
    create: (input: {
      applicantUserId: string;
      voucherUserId: string;
      voucherRole: 'family' | 'service-provider';
      relationship: string;
      expiresAt: Date;
    }) => Effect.Effect<Vouch, SqlError>;
    findById: (id: string) => Effect.Effect<Vouch, SqlError | DBNotFoundError>;
    /** A pending (unexpired) or accepted vouch between this pair, if any. */
    findOpenByPair: (
      applicantUserId: string,
      voucherUserId: string
    ) => Effect.Effect<Vouch | null, SqlError>;
    listForApplicants: (
      applicantUserIds: ReadonlyArray<string>
    ) => Effect.Effect<Array<VouchWithVoucher>, SqlError>;
    listForVoucher: (voucherUserId: string) => Effect.Effect<Array<VouchWithApplicant>, SqlError>;
    /** Conditional update; null when the row was not in an allowed state. */
    transition: (input: VouchTransition) => Effect.Effect<Vouch | null, SqlError>;
  }
>() {}

export const VouchRepoLive = Layer.effect(
  VouchRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      create: (input) =>
        db
          .insert(vouch)
          .values({ ...input, status: 'pending' })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      findById: (id) =>
        db
          .select()
          .from(vouch)
          .where(eq(vouch.id, id))
          .limit(1)
          .pipe(
            Effect.flatMap((rows) =>
              rows[0]
                ? Effect.succeed(rows[0])
                : Effect.fail(new DBNotFoundError({ entity: 'vouch', value: id }))
            )
          ),
      findOpenByPair: (applicantUserId, voucherUserId) =>
        db
          .select()
          .from(vouch)
          .where(
            and(
              eq(vouch.applicantUserId, applicantUserId),
              eq(vouch.voucherUserId, voucherUserId),
              or(
                eq(vouch.status, 'accepted'),
                and(eq(vouch.status, 'pending'), gt(vouch.expiresAt, new Date()))
              )
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      listForApplicants: (applicantUserIds) =>
        applicantUserIds.length === 0
          ? Effect.succeed([])
          : db
              .select({
                vouch,
                name: user.name,
                email: user.email,
                banned: user.banned,
                banExpires: user.banExpires,
                emailVerified: user.emailVerified,
                firstName: userProfile.firstName,
                lastName: userProfile.lastName,
                currentApprovalId: approval.id
              })
              .from(vouch)
              .innerJoin(user, eq(user.id, vouch.voucherUserId))
              .leftJoin(userProfile, eq(userProfile.userId, vouch.voucherUserId))
              .leftJoin(
                approval,
                and(
                  eq(approval.userId, vouch.voucherUserId),
                  eq(approval.status, 'approved'),
                  gt(approval.expiresAt, new Date())
                )
              )
              .where(inArray(vouch.applicantUserId, [...applicantUserIds]))
              .orderBy(desc(vouch.createdAt))
              .pipe(
                Effect.map((rows) => {
                  // The approval join can fan out; collapse to one row per vouch.
                  const byId = new Map<string, VouchWithVoucher>();
                  for (const row of rows) {
                    const existing = byId.get(row.vouch.id);
                    if (existing) {
                      existing.voucher.hasLiveApproval ||= row.currentApprovalId !== null;
                      continue;
                    }
                    byId.set(row.vouch.id, {
                      ...row.vouch,
                      voucher: {
                        name: row.name,
                        email: row.email,
                        firstName: row.firstName ?? null,
                        lastName: row.lastName ?? null,
                        banned: row.banned,
                        banExpires: row.banExpires,
                        emailVerified: row.emailVerified,
                        hasLiveApproval: row.currentApprovalId !== null
                      }
                    });
                  }
                  return [...byId.values()];
                })
              ),
      listForVoucher: (voucherUserId) =>
        db
          .select({
            vouch,
            name: user.name,
            image: user.image,
            firstName: userProfile.firstName,
            lastName: userProfile.lastName
          })
          .from(vouch)
          .innerJoin(user, eq(user.id, vouch.applicantUserId))
          .leftJoin(userProfile, eq(userProfile.userId, vouch.applicantUserId))
          .where(eq(vouch.voucherUserId, voucherUserId))
          .orderBy(desc(vouch.createdAt))
          .pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                ...row.vouch,
                applicant: {
                  name: row.name,
                  image: row.image,
                  firstName: row.firstName ?? null,
                  lastName: row.lastName ?? null
                }
              }))
            )
          ),
      transition: (input) =>
        db
          .update(vouch)
          .set(input.set)
          .where(
            and(
              eq(vouch.id, input.id),
              inArray(vouch.status, [...input.from]),
              input.notExpired ? gt(vouch.expiresAt, new Date()) : undefined,
              input.voucherUserId ? eq(vouch.voucherUserId, input.voucherUserId) : undefined
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null))
    };
  })
);

export const VouchRepoDefault = VouchRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeVouchRepoTest = (implementation: Context.Tag.Service<VouchRepo>) =>
  Layer.succeed(VouchRepo, implementation);

export const dummyVouch: Vouch = {
  id: 'vouch-1',
  applicantUserId: 'applicant-1',
  voucherUserId: 'voucher-1',
  voucherRole: 'family',
  relationship: 'Neighbour for three years',
  status: 'pending',
  answers: null,
  attestedAt: null,
  submittedIp: null,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  decidedAt: null,
  revokedBy: null,
  adminReason: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z')
};

export const EmptyVouchRepoTest = makeVouchRepoTest({
  create: () => Effect.succeed(dummyVouch),
  findById: (id) => Effect.fail(new DBNotFoundError({ entity: 'vouch', value: id })),
  findOpenByPair: () => Effect.succeed(null),
  listForApplicants: () => Effect.succeed([]),
  listForVoucher: () => Effect.succeed([]),
  transition: () => Effect.succeed(null)
});
```

- [ ] **Step 5: Add `updateGeneralRemarks` to `ApprovalRequestRepo`**

In `packages/db/src/repos/approval-request-repo.ts`, add to the tag interface after `reject`:

```ts
    updateGeneralRemarks: (
      id: string,
      remarks: string | null,
      updatedBy: string
    ) => Effect.Effect<ApprovalRequest, SqlError | DBNotFoundError>;
```

Add to the live implementation after `reject`:

```ts
      updateGeneralRemarks: (id, remarks, updatedBy) =>
        db
          .update(approvalRequest)
          .set({
            generalRemarks: remarks,
            generalRemarksUpdatedBy: updatedBy,
            generalRemarksUpdatedAt: new Date()
          })
          .where(eq(approvalRequest.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
```

Add to `EmptyApprovalRequestRepoTest`:

```ts
  updateGeneralRemarks: () =>
    Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: '' })),
```

Then find every other full `makeApprovalRequestRepoTest({...})` object and add `updateGeneralRemarks: () => Effect.die('not used')`:

Run: `grep -rln "makeApprovalRequestRepoTest(" apps packages --include=*.ts | grep -v node_modules | grep -v dist`

- [ ] **Step 6: Export and type-check**

In `packages/db/src/index.ts`, after the referral-repo export line add:

```ts
export * from './repos/vouch-repo';
```

Run: `cd apps/api && bunx tsc --noEmit -p tsconfig.json`
Expected: no errors. Any error naming `updateGeneralRemarks` is a test helper you missed in Step 5.

- [ ] **Step 7: Apply the migration on the local stack**

Run `docker compose up -d`, or restart the `migrations` container if the stack is already up. Then:
`docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d app_db.vouches"'`
Expected: the table prints with the `vouches_pair_accepted_uidx` partial index.

- [ ] **Step 8: Commit**

```bash
git add packages/db apps/api/src
git commit -m "feat(db): vouches table and approval-request general remarks"
```

---

### Task 2: Pure vouch rules

**Files:**
- Modify: `apps/api/src/lib/constants.ts`
- Create: `apps/api/src/lib/vouches.ts`
- Test: `apps/api/src/lib/vouches.unit.test.ts`

**Interfaces:**
- Consumes: `Vouch`, `VoucherStanding`, `VouchWithVoucher` from `@repo/db` (Task 1).
- Produces:
  - `RECOMMENDED_VOUCHES: 2`, `vouchRequestTtlMs: number`
  - `presentedVouchStatus(v: Pick<Vouch,'status'|'expiresAt'>, now: Date): PresentedVouchStatus`, where `PresentedVouchStatus = VouchStatus | 'expired'`
  - `isBannedNow(u: {banned: boolean | null; banExpires: Date | null}, now: Date): boolean`
  - `canVouch(s: VoucherStanding, now: Date): boolean`
  - `vouchCounts(v: VouchWithVoucher, now: Date): boolean`
  - `summariseVouches(vs: Array<VouchWithVoucher>, now: Date): { counting: number; hasConcern: boolean }`
  - `applicantVouchStatus(v: VouchWithVoucher, now: Date): ApplicantVouchStatus`, where `ApplicantVouchStatus = 'pending' | 'completed' | 'declined' | 'expired' | 'not_counted'`

- [ ] **Step 1: Add constants**

Append to `apps/api/src/lib/constants.ts`:

```ts
/** Vouches a helper applicant is encouraged (not required) to collect. */
export const RECOMMENDED_VOUCHES = 2;
export const vouchRequestTtlMs = 14 * 24 * 60 * 60 * 1000;
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/lib/vouches.unit.test.ts`:

```ts
import { dummyVouch, type VouchWithVoucher } from '@repo/db';
import { describe, expect, it } from 'vitest';
import {
  applicantVouchStatus,
  canVouch,
  presentedVouchStatus,
  summariseVouches,
  vouchCounts
} from './vouches';

const NOW = new Date('2026-10-01T12:00:00.000Z');

const standing = { banned: false, banExpires: null, emailVerified: true, hasLiveApproval: true };

const entry = (
  overrides: Partial<VouchWithVoucher> = {},
  voucher: Partial<VouchWithVoucher['voucher']> = {}
): VouchWithVoucher => ({
  ...dummyVouch,
  status: 'accepted',
  answers: {
    howKnow: 'Neighbour',
    howLong: '3 years',
    wouldTrust: 'yes',
    hasConcerns: false,
    concernsDetail: null,
    wouldHire: 'yes',
    anythingElse: null
  },
  ...overrides,
  voucher: { name: 'V', email: 'v@x.dev', firstName: null, lastName: null, ...standing, ...voucher }
});

describe('presentedVouchStatus', () => {
  it('presents a pending vouch past its expiry as expired', () => {
    expect(
      presentedVouchStatus({ status: 'pending', expiresAt: new Date('2026-09-30T00:00:00Z') }, NOW)
    ).toBe('expired');
  });
  it('keeps an accepted vouch accepted after the request window', () => {
    expect(
      presentedVouchStatus({ status: 'accepted', expiresAt: new Date('2026-09-30T00:00:00Z') }, NOW)
    ).toBe('accepted');
  });
});

describe('canVouch', () => {
  it('requires a live approval, a verified email and no active ban', () => {
    expect(canVouch(standing, NOW)).toBe(true);
    expect(canVouch({ ...standing, hasLiveApproval: false }, NOW)).toBe(false);
    expect(canVouch({ ...standing, emailVerified: false }, NOW)).toBe(false);
    expect(canVouch({ ...standing, banned: true }, NOW)).toBe(false);
  });
  it('treats a ban that has run out as no ban', () => {
    expect(
      canVouch({ ...standing, banned: true, banExpires: new Date('2026-09-01T00:00:00Z') }, NOW)
    ).toBe(true);
  });
});

describe('vouchCounts / summariseVouches', () => {
  it('counts only accepted vouches from vouchers in good standing', () => {
    expect(vouchCounts(entry(), NOW)).toBe(true);
    expect(vouchCounts(entry({ status: 'flagged' }), NOW)).toBe(false);
    expect(vouchCounts(entry({}, { hasLiveApproval: false }), NOW)).toBe(false);
  });
  it('counts distinct vouchers, so one person never fills two slots', () => {
    const summary = summariseVouches(
      [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c', voucherUserId: 'voucher-2' })],
      NOW
    );
    expect(summary.counting).toBe(2);
  });
  it('raises a concern for a flagged vouch or an accepted one that answered yes to concerns', () => {
    expect(summariseVouches([entry({ status: 'flagged' })], NOW).hasConcern).toBe(true);
    expect(
      summariseVouches(
        [entry({ answers: { ...entry().answers!, hasConcerns: true, concernsDetail: 'Late' } })],
        NOW
      ).hasConcern
    ).toBe(true);
    expect(summariseVouches([entry()], NOW).hasConcern).toBe(false);
  });
});

describe('applicantVouchStatus', () => {
  it('never tells the applicant why a vouch stopped counting', () => {
    expect(applicantVouchStatus(entry({ status: 'flagged' }), NOW)).toBe('not_counted');
    expect(applicantVouchStatus(entry({ status: 'revoked' }), NOW)).toBe('not_counted');
    expect(applicantVouchStatus(entry({}, { banned: true }), NOW)).toBe('not_counted');
    expect(applicantVouchStatus(entry(), NOW)).toBe('completed');
    expect(applicantVouchStatus(entry({ status: 'declined' }), NOW)).toBe('declined');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/api && bunx vitest run src/lib/vouches.unit.test.ts`
Expected: FAIL, "Failed to resolve import ./vouches".

- [ ] **Step 4: Implement**

`apps/api/src/lib/vouches.ts`:

```ts
import type { Vouch, VoucherStanding, VouchStatus, VouchWithVoucher } from '@repo/db';

/**
 * The vouch rules, in one place and free of I/O. Nothing here is stored:
 * whether a vouch has expired or still counts is decided at read time from
 * the row and the voucher's CURRENT standing, so a voucher who is banned or
 * loses their approval stops counting the moment it happens.
 *
 * Vouches never gate approval — these answers drive the applicant's nudge
 * and the admin queue only.
 */

export type PresentedVouchStatus = VouchStatus | 'expired';

export const presentedVouchStatus = (
  vouch: Pick<Vouch, 'status' | 'expiresAt'>,
  now: Date
): PresentedVouchStatus =>
  vouch.status === 'pending' && vouch.expiresAt <= now ? 'expired' : vouch.status;

export const isBannedNow = (
  account: { banned: boolean | null; banExpires: Date | null },
  now: Date
) => account.banned === true && (account.banExpires === null || account.banExpires > now);

/** Families and helpers alike: approved, verified email, not banned. */
export const canVouch = (standing: VoucherStanding, now: Date) =>
  !isBannedNow(standing, now) && standing.emailVerified && standing.hasLiveApproval;

export const vouchCounts = (vouch: VouchWithVoucher, now: Date) =>
  presentedVouchStatus(vouch, now) === 'accepted' && canVouch(vouch.voucher, now);

export const summariseVouches = (vouches: Array<VouchWithVoucher>, now: Date) => {
  // Distinct vouchers: one person can never fill two slots.
  const counting = new Set(
    vouches.filter((vouch) => vouchCounts(vouch, now)).map((vouch) => vouch.voucherUserId)
  );
  const hasConcern = vouches.some(
    (vouch) =>
      vouch.status === 'flagged' ||
      (vouch.status === 'accepted' && vouch.answers?.hasConcerns === true)
  );
  return { counting: counting.size, hasConcern };
};

/** What the applicant may see. Flagged, revoked and a voucher who lost
 * standing all collapse into one vague state, so nobody learns which
 * voucher raised a concern or why. */
export type ApplicantVouchStatus = 'pending' | 'completed' | 'declined' | 'expired' | 'not_counted';

export const applicantVouchStatus = (vouch: VouchWithVoucher, now: Date): ApplicantVouchStatus => {
  switch (presentedVouchStatus(vouch, now)) {
    case 'pending':
      return 'pending';
    case 'declined':
      return 'declined';
    case 'expired':
      return 'expired';
    case 'accepted':
      return canVouch(vouch.voucher, now) ? 'completed' : 'not_counted';
    default:
      return 'not_counted';
  }
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && bunx vitest run src/lib/vouches.unit.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/constants.ts apps/api/src/lib/vouches.ts apps/api/src/lib/vouches.unit.test.ts
git commit -m "feat(api): pure vouch counting rules"
```

---

### Task 3: Vouch API (applicant, voucher, admin) with mail and notifications

**Files:**
- Modify: `packages/mail/src/templates.ts`, `packages/mail/src/mailer.ts`
- Modify: `packages/notify/src/events.ts`
- Modify: `apps/api/src/lib/auth-roles.ts`
- Create: `apps/api/src/routes/app/vouches/vouches.validator.ts`
- Create: `apps/api/src/routes/app/vouches/vouches.handler.ts`
- Create: `apps/api/src/routes/app/vouches/vouches.ts`
- Create: `apps/api/src/routes/app/admin/vouches.ts`
- Modify: `apps/api/src/routes/app/index.ts`, `apps/api/src/managed-runtime.ts`, `apps/api/src/app-env.ts`
- Test: `apps/api/src/routes/app/vouches/vouches.unit.test.ts`

**Interfaces:**
- Consumes: Task 1 repo, Task 2 rules, `ApprovalRepo.findCurrentByUserId`, `UserRepo.findByEmail/findById`, `UserProfileRepo.findByUserId`, `Mailer`, `publishNotificationBestEffort`.
- Produces HTTP:
  - `GET /vouches/mine` → `{ vouches: Array<{ id; voucherName; voucherEmail; relationship; status: ApplicantVouchStatus; requestedAt: string }>; counting: number; recommended: number }`
  - `POST /vouches` body `{ email, relationship }` → one applicant entry
  - `GET /vouches/requests` → `{ requests: Array<{ id; applicantName; applicantImage: string | null; relationship; status: PresentedVouchStatus; requestedAt; expiresAt }> }`
  - `POST /vouches/:id/submit` body `VouchAnswers & { attested: true }` → `{ id, status: 'accepted' }`
  - `POST /vouches/:id/decline` → `{ id, status: 'declined' }`
  - `POST /vouches/:id/withdraw` → `{ id, status: 'revoked' }`
  - `POST /admin/vouches/:id/flag` and `/revoke`, body `{ reason }` → `{ id, status }`
- Produces code: `toAdminVouch(v: VouchWithVoucher, now: Date)`, exported from `vouches.handler.ts` for Task 4.

- [ ] **Step 1: Mail template and mailer method**

In `packages/mail/src/templates.ts`, add after `referralInviteMail`:

```ts
export const vouchRequestMail = (mail: {
  applicantName: string;
  relationship: string;
  link: string;
}): MailContent => ({
  subject: `${mail.applicantName} asked you to vouch for them on Poppynz`,
  html: layout(
    paragraph('Hi,') +
      paragraph(
        `${escapeHtml(mail.applicantName)} is applying to be a helper on Poppynz and asked you to vouch for them. They describe how they know you as: <i>${escapeHtml(mail.relationship)}</i>.`
      ) +
      paragraph(
        'A vouch is a personal endorsement. Only say yes if you know this person and would trust them with care. Your answers are seen only by the Poppynz team, never by the applicant.'
      ) +
      button(mail.link, 'Review the request') +
      paragraph("If you don't know this person, decline the request.")
  ),
  text: [
    'Hi,',
    '',
    `${mail.applicantName} is applying to be a helper on Poppynz and asked you to vouch for them.`,
    `How they know you: ${mail.relationship}`,
    '',
    'A vouch is a personal endorsement. Only say yes if you know this person and would trust them with care. Your answers are seen only by the Poppynz team, never by the applicant.',
    '',
    `Review the request: ${mail.link}`,
    '',
    "If you don't know this person, decline the request."
  ].join('\n')
});
```

In `packages/mail/src/mailer.ts`:
- Import `vouchRequestMail`.
- Add the type after `ReferralInviteMail`:

```ts
export type VouchRequestMail = {
  email: string;
  applicantName: string;
  relationship: string;
  link: string;
};
```

- Add `sendVouchRequest: (mail: VouchRequestMail) => Effect.Effect<void, MailerError>;` to the tag interface, after `sendReferralInvite`.
- Add `sendVouchRequest: (mail) => deliver([mail.email], vouchRequestMail(mail)),` to the live implementation, after `sendReferralInvite`.
- Add `sendVouchRequest: () => Effect.void,` to the `makeMailerTest` defaults.

- [ ] **Step 2: Notification events**

In `packages/notify/src/events.ts`, add to `NotificationPayloads` after `'safety_verification.updated'`:

```ts
  /** Someone asked the viewer to vouch for them. */
  'vouch.requested': {
    vouchId: string;
    applicantName: string;
  };
  /** One of the viewer's own vouch requests moved. Deliberately empty — the
   * applicant must never learn which voucher was flagged or why; the page
   * refetches its generic list. */
  'vouch.updated': Record<string, never>;
```

- [ ] **Step 3: Permissions**

In `apps/api/src/lib/auth-roles.ts`:
- Add `vouch: ['read', 'write', 'review'],` to `appAc` (alphabetical, after `userSearch`).
- Add `vouch: ['read', 'write'],` to `familyRole` and `spRole`.
- Add `vouch: ['read', 'write', 'review'],` to `adminRole`.

- [ ] **Step 4: Validator**

`apps/api/src/routes/app/vouches/vouches.validator.ts`:

```ts
import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';
import { normalizedEmailSchema } from '../auth/signup/signup.validator';

export const vouchValidationError = {
  code: 'INVALID_VOUCH_INPUT',
  message: 'Vouch input contains invalid or unsupported fields.'
} as const;

const requiredText = (max: number) => Schema.Trim.pipe(Schema.nonEmptyString(), Schema.maxLength(max));
const optionalText = Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(2000))));
const trustAnswer = Schema.Literal('yes', 'no', 'unsure');

export const vouchRequestSchema = Schema.Struct({
  email: normalizedEmailSchema,
  relationship: requiredText(300)
});

export const vouchSubmitSchema = Schema.Struct({
  howKnow: requiredText(1000),
  howLong: requiredText(100),
  wouldTrust: trustAnswer,
  hasConcerns: Schema.Boolean,
  concernsDetail: optionalText,
  wouldHire: trustAnswer,
  anythingElse: optionalText,
  // The attestation is not optional: a vouch without it is not a vouch.
  attested: Schema.Literal(true)
});

export const vouchAdminActionSchema = Schema.Struct({ reason: requiredText(500) });

export type VouchRequestInput = Schema.Schema.Type<typeof vouchRequestSchema>;
export type VouchSubmitInput = Schema.Schema.Type<typeof vouchSubmitSchema>;

export const validateVouchRequestInput = validateInput(vouchRequestSchema, vouchValidationError);
export const validateVouchSubmitInput = validateInput(vouchSubmitSchema, vouchValidationError);
export const validateVouchAdminActionInput = validateInput(
  vouchAdminActionSchema,
  vouchValidationError
);
export const vouchJsonError = vouchValidationError;
```

- [ ] **Step 5: Write the failing program tests**

`apps/api/src/routes/app/vouches/vouches.unit.test.ts`. Use the user/session builders from `referrals.unit.test.ts` (lines 24–50) as the template:

```ts
import {
  DBNotFoundError,
  dummyVouch,
  makeApprovalRepoTest,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  makeVouchRepoTest,
  type Approval,
  type Session,
  type User,
  type Vouch,
  type VouchTransition,
  type VouchWithVoucher
} from '@repo/db';
import { makeNotificationHubTest } from '@repo/notify';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { makeMailerTest, type VouchRequestMail } from '@/api/lib/mailer';
import {
  adminVouchActionProgram,
  listMyVouchesProgram,
  requestVouchProgram,
  submitVouchProgram,
  withdrawVouchProgram
} from './vouches.handler';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'applicant-1',
  name: 'Ana Applicant',
  email: 'ana@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  isAnonymous: false,
  role: 'service-provider',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides
});

const session = (userId: string): Session => ({
  id: 'session-1',
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  token: 'token',
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ipAddress: null,
  userAgent: null,
  userId,
  impersonatedBy: null,
  activeOrganizationId: null
});

const applicant = user();
const voucher = user({ id: 'voucher-1', name: 'Vera Voucher', email: 'vera@example.com', role: 'family' });
const asSession = (u: User) => ({ user: u as never, session: session(u.id) });

const liveApproval = (userId: string) =>
  ({ id: `approval-${userId}`, userId, status: 'approved', expiresAt: new Date('2099-01-01') }) as Approval;

const makeLayer = (
  options: {
    approved?: Record<string, boolean>;
    vouch?: Vouch;
    openPair?: Vouch | null;
    listed?: Array<VouchWithVoucher>;
    transitionResult?: Vouch | null;
    onCreate?: (input: unknown) => void;
    onTransition?: (input: VouchTransition) => void;
    sent?: Array<VouchRequestMail>;
  } = {}
) =>
  Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: applicant.id }, session: { id: 'session-1' } }),
      userHasPermission: () => Effect.succeed(true)
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session(applicant.id)) }),
    makeUserRepoTest({
      findById: (id) =>
        id === voucher.id ? Effect.succeed(voucher) : Effect.succeed(applicant),
      findByEmail: (email) =>
        email === voucher.email
          ? Effect.succeed(voucher)
          : email === applicant.email
            ? Effect.succeed(applicant)
            : Effect.fail(new DBNotFoundError({ entity: 'user', value: email }))
    }),
    makeUserProfileRepoTest({
      create: () => Effect.die('not used'),
      findByUserId: () => Effect.fail(new DBNotFoundError({ entity: 'profile', value: '' })),
      updateByUserId: () => Effect.die('not used'),
      updateLocationByUserId: () => Effect.die('not used')
    }),
    makeApprovalRepoTest({
      findCurrentByUserId: (userId) =>
        (options.approved?.[userId] ?? true)
          ? Effect.succeed(liveApproval(userId))
          : Effect.fail(new DBNotFoundError({ entity: 'approval', value: userId }))
    }),
    makeVouchRepoTest({
      create: (input) => {
        options.onCreate?.(input);
        return Effect.succeed({ ...dummyVouch, ...input });
      },
      findById: (id) =>
        options.vouch
          ? Effect.succeed(options.vouch)
          : Effect.fail(new DBNotFoundError({ entity: 'vouch', value: id })),
      findOpenByPair: () => Effect.succeed(options.openPair ?? null),
      listForApplicants: () => Effect.succeed(options.listed ?? []),
      listForVoucher: () => Effect.succeed([]),
      transition: (input) => {
        options.onTransition?.(input);
        return Effect.succeed(
          options.transitionResult === undefined
            ? { ...(options.vouch ?? dummyVouch), ...input.set }
            : options.transitionResult
        );
      }
    }),
    makeMailerTest({
      sendVouchRequest: (mail) => {
        options.sent?.push(mail);
        return Effect.void;
      }
    }),
    makeNotificationHubTest({ publish: () => Effect.void, subscribe: () => Effect.die('not used') })
  );

const failureOf = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected failure');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

const ctx = { uiOrigin: 'http://localhost:5173' };
const answers = {
  howKnow: 'Neighbour',
  howLong: '3 years',
  wouldTrust: 'yes' as const,
  hasConcerns: false,
  wouldHire: 'yes' as const,
  attested: true as const
};

describe('requestVouchProgram', () => {
  it('creates a pending vouch and emails the voucher', async () => {
    const created: Array<unknown> = [];
    const sent: Array<VouchRequestMail> = [];
    const result = await Effect.runPromise(
      requestVouchProgram(
        asSession(applicant),
        { email: voucher.email, relationship: 'Neighbour' },
        ctx
      ).pipe(Effect.provide(makeLayer({ onCreate: (i) => created.push(i), sent })))
    );
    expect(created[0]).toMatchObject({
      applicantUserId: applicant.id,
      voucherUserId: voucher.id,
      voucherRole: 'family'
    });
    expect(sent[0]).toMatchObject({ email: voucher.email, link: 'http://localhost:5173/family/vouches' });
    expect(result.status).toBe('pending');
  });

  it('refuses the applicant themself with the same vague error as an unknown email', async () => {
    const self = await Effect.runPromiseExit(
      requestVouchProgram(asSession(applicant), { email: applicant.email, relationship: 'Me' }, ctx).pipe(
        Effect.provide(makeLayer())
      )
    );
    const unknown = await Effect.runPromiseExit(
      requestVouchProgram(asSession(applicant), { email: 'nobody@x.dev', relationship: 'X' }, ctx).pipe(
        Effect.provide(makeLayer())
      )
    );
    expect(failureOf(self)).toMatchObject({ _tag: 'VoucherUnavailableError' });
    expect(failureOf(unknown)).toMatchObject({ _tag: 'VoucherUnavailableError' });
  });

  it('refuses a voucher without a live approval', async () => {
    const exit = await Effect.runPromiseExit(
      requestVouchProgram(asSession(applicant), { email: voucher.email, relationship: 'X' }, ctx).pipe(
        Effect.provide(makeLayer({ approved: { [voucher.id]: false } }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VoucherUnavailableError' });
  });

  it('refuses a second open request to the same voucher', async () => {
    const exit = await Effect.runPromiseExit(
      requestVouchProgram(asSession(applicant), { email: voucher.email, relationship: 'X' }, ctx).pipe(
        Effect.provide(makeLayer({ openPair: dummyVouch }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchAlreadyRequestedError' });
  });

  it('only lets helpers ask for vouches', async () => {
    const exit = await Effect.runPromiseExit(
      requestVouchProgram(asSession(voucher), { email: applicant.email, relationship: 'X' }, ctx).pipe(
        Effect.provide(makeLayer())
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchApplicantOnlyError' });
  });
});

describe('listMyVouchesProgram', () => {
  it('hides answers and collapses flagged into not_counted', async () => {
    const flagged: VouchWithVoucher = {
      ...dummyVouch,
      status: 'flagged',
      answers: { howKnow: 'x', howLong: 'y', wouldTrust: 'no', hasConcerns: true, concernsDetail: 'secret', wouldHire: 'no', anythingElse: null },
      adminReason: 'secret reason',
      voucher: { name: 'Vera', email: 'vera@example.com', firstName: null, lastName: null, banned: false, banExpires: null, emailVerified: true, hasLiveApproval: true }
    };
    const result = await Effect.runPromise(
      listMyVouchesProgram(asSession(applicant)).pipe(Effect.provide(makeLayer({ listed: [flagged] })))
    );
    expect(result.vouches[0].status).toBe('not_counted');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).toMatchObject({ counting: 0, recommended: 2 });
  });
});

describe('submitVouchProgram', () => {
  it('accepts with answers, attestation time and IP, only while pending', async () => {
    const transitions: Array<VouchTransition> = [];
    await Effect.runPromise(
      submitVouchProgram(asSession(voucher), dummyVouch.id, answers, '203.0.113.9').pipe(
        Effect.provide(
          makeLayer({ vouch: { ...dummyVouch, voucherUserId: voucher.id }, onTransition: (t) => transitions.push(t) })
        )
      )
    );
    expect(transitions[0]).toMatchObject({
      from: ['pending'],
      notExpired: true,
      voucherUserId: voucher.id,
      set: { status: 'accepted', submittedIp: '203.0.113.9' }
    });
    expect(transitions[0].set.attestedAt).toBeInstanceOf(Date);
  });

  it("treats someone else's vouch as not found", async () => {
    const exit = await Effect.runPromiseExit(
      submitVouchProgram(asSession(voucher), dummyVouch.id, answers, null).pipe(
        Effect.provide(makeLayer({ vouch: { ...dummyVouch, voucherUserId: 'someone-else' } }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchNotFoundError' });
  });
});

describe('withdrawVouchProgram', () => {
  it('refuses once the applicant is approved', async () => {
    const exit = await Effect.runPromiseExit(
      withdrawVouchProgram(asSession(voucher), dummyVouch.id).pipe(
        Effect.provide(
          makeLayer({ vouch: { ...dummyVouch, voucherUserId: voucher.id, status: 'accepted' } })
        )
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchLockedError' });
  });

  it('revokes an accepted vouch while the applicant is unapproved', async () => {
    const transitions: Array<VouchTransition> = [];
    await Effect.runPromise(
      withdrawVouchProgram(asSession(voucher), dummyVouch.id).pipe(
        Effect.provide(
          makeLayer({
            vouch: { ...dummyVouch, voucherUserId: voucher.id, status: 'accepted' },
            approved: { [dummyVouch.applicantUserId]: false },
            onTransition: (t) => transitions.push(t)
          })
        )
      )
    );
    expect(transitions[0]).toMatchObject({ from: ['accepted'], set: { status: 'revoked', revokedBy: voucher.id } });
  });
});

describe('adminVouchActionProgram', () => {
  it('flags a pending or accepted vouch with the admin and reason recorded', async () => {
    const transitions: Array<VouchTransition> = [];
    await Effect.runPromise(
      adminVouchActionProgram('admin-1', dummyVouch.id, 'flagged', 'Same household as applicant').pipe(
        Effect.provide(makeLayer({ onTransition: (t) => transitions.push(t) }))
      )
    );
    expect(transitions[0]).toMatchObject({
      from: ['pending', 'accepted'],
      set: { status: 'flagged', revokedBy: 'admin-1', adminReason: 'Same household as applicant' }
    });
  });

  it('fails with VouchStateError when the vouch already moved', async () => {
    const exit = await Effect.runPromiseExit(
      adminVouchActionProgram('admin-1', dummyVouch.id, 'revoked', 'x').pipe(
        Effect.provide(makeLayer({ transitionResult: null }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'VouchStateError' });
  });
});
```

If `makeApprovalRepoTest` takes a full implementation rather than a partial one, check its signature in `packages/db/src/repos/approval-repo.ts:170` and spread `EmptyApprovalRepoTest`-style defaults the way `conversations.unit.test.ts:258` does.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd apps/api && bunx vitest run src/routes/app/vouches/vouches.unit.test.ts`
Expected: FAIL, "Failed to resolve import ./vouches.handler".

- [ ] **Step 7: Implement the handler**

`apps/api/src/routes/app/vouches/vouches.handler.ts`:

```ts
import type { SqlError } from '@effect/sql/SqlError';
import {
  ApprovalRepo,
  DBNotFoundError,
  UserProfileRepo,
  UserRepo,
  VouchRepo,
  type VouchWithVoucher
} from '@repo/db';
import { publishNotificationBestEffort } from '@repo/notify';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions,
  type UserAndSession
} from '@/api/lib/effect-auth';
import { RECOMMENDED_VOUCHES, vouchRequestTtlMs } from '@/api/lib/constants';
import { Mailer, sendMailBestEffort } from '@/api/lib/mailer';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import { resolveUiOrigin } from '@/api/lib/ui-origin';
import {
  applicantVouchStatus,
  canVouch,
  presentedVouchStatus,
  summariseVouches,
  vouchCounts
} from '@/api/lib/vouches';
import {
  validateVouchAdminActionInput,
  validateVouchRequestInput,
  validateVouchSubmitInput,
  vouchJsonError,
  type VouchRequestInput,
  type VouchSubmitInput
} from './vouches.validator';

export class VouchRepoError extends Data.TaggedError('VouchRepoError')<{ cause: SqlError }> {}
export class VouchApplicantOnlyError extends Data.TaggedError('VouchApplicantOnlyError')<{}> {}
/** One vague error for unknown email, self, wrong role and ineligible
 * voucher — the form must not become a way to probe who is approved. */
export class VoucherUnavailableError extends Data.TaggedError('VoucherUnavailableError')<{}> {}
export class VouchAlreadyRequestedError extends Data.TaggedError('VouchAlreadyRequestedError')<{}> {}
export class VouchNotFoundError extends Data.TaggedError('VouchNotFoundError')<{}> {}
export class VouchStateError extends Data.TaggedError('VouchStateError')<{}> {}
export class VouchLockedError extends Data.TaggedError('VouchLockedError')<{}> {}

const repoError = (cause: SqlError) => new VouchRepoError({ cause });

const fullName = (
  person: { firstName: string | null; lastName: string | null },
  fallback: string
) => [person.firstName, person.lastName].filter(Boolean).join(' ') || fallback;

const hasLiveApproval = (userId: string) =>
  ApprovalRepo.pipe(
    Effect.flatMap((repo) => repo.findCurrentByUserId(userId)),
    Effect.as(true),
    Effect.catchTags({
      DBNotFoundError: () => Effect.succeed(false),
      SqlError: (cause) => Effect.fail(repoError(cause))
    })
  );

const toApplicantVouch = (vouch: VouchWithVoucher, now: Date) => ({
  id: vouch.id,
  voucherName: fullName(vouch.voucher, vouch.voucher.name),
  voucherEmail: vouch.voucher.email,
  relationship: vouch.relationship,
  status: applicantVouchStatus(vouch, now),
  requestedAt: vouch.createdAt.toISOString()
});

/** The admin's full view of one vouch — answers included. Used by the
 * approval-request detail; never returned from an applicant route. */
export const toAdminVouch = (vouch: VouchWithVoucher, now: Date) => ({
  id: vouch.id,
  voucher: {
    userId: vouch.voucherUserId,
    name: fullName(vouch.voucher, vouch.voucher.name),
    email: vouch.voucher.email,
    role: vouch.voucherRole,
    inGoodStanding: canVouch(vouch.voucher, now)
  },
  relationship: vouch.relationship,
  status: presentedVouchStatus(vouch, now),
  counts: vouchCounts(vouch, now),
  answers: vouch.answers,
  attestedAt: vouch.attestedAt?.toISOString() ?? null,
  submittedIp: vouch.submittedIp,
  requestedAt: vouch.createdAt.toISOString(),
  decidedAt: vouch.decidedAt?.toISOString() ?? null,
  adminReason: vouch.adminReason
});

const loadVoucherOwned = (vouchId: string, voucherUserId: string) =>
  VouchRepo.pipe(
    Effect.flatMap((repo) => repo.findById(vouchId)),
    Effect.catchTags({
      DBNotFoundError: () => Effect.fail(new VouchNotFoundError()),
      SqlError: (cause) => Effect.fail(repoError(cause))
    }),
    Effect.flatMap((vouch) =>
      vouch.voucherUserId === voucherUserId
        ? Effect.succeed(vouch)
        : Effect.fail(new VouchNotFoundError())
    )
  );

export const requestVouchProgram = (
  userAndSession: UserAndSession,
  input: VouchRequestInput,
  context: { uiOrigin: string }
) =>
  Effect.gen(function* () {
    const applicant = userAndSession.user;
    if (applicant.role !== 'service-provider') {
      return yield* Effect.fail(new VouchApplicantOnlyError());
    }
    if (input.email === applicant.email.toLowerCase()) {
      return yield* Effect.fail(new VoucherUnavailableError());
    }

    const userRepo = yield* UserRepo;
    const voucher = yield* userRepo.findByEmail(input.email).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.fail(new VoucherUnavailableError()),
        SqlError: (cause) => Effect.fail(repoError(cause))
      })
    );
    const voucherRole = voucher.role;
    if (voucher.id === applicant.id || (voucherRole !== 'family' && voucherRole !== 'service-provider')) {
      return yield* Effect.fail(new VoucherUnavailableError());
    }
    const now = new Date();
    const standing = {
      banned: voucher.banned,
      banExpires: voucher.banExpires,
      emailVerified: voucher.emailVerified,
      hasLiveApproval: yield* hasLiveApproval(voucher.id)
    };
    if (!canVouch(standing, now)) {
      return yield* Effect.fail(new VoucherUnavailableError());
    }

    const vouchRepo = yield* VouchRepo;
    const open = yield* vouchRepo
      .findOpenByPair(applicant.id, voucher.id)
      .pipe(Effect.mapError(repoError));
    if (open) {
      return yield* Effect.fail(new VouchAlreadyRequestedError());
    }

    const created = yield* vouchRepo
      .create({
        applicantUserId: applicant.id,
        voucherUserId: voucher.id,
        voucherRole,
        relationship: input.relationship,
        expiresAt: new Date(now.getTime() + vouchRequestTtlMs)
      })
      .pipe(Effect.mapError(repoError));

    const profile = yield* UserProfileRepo.pipe(
      Effect.flatMap((repo) => repo.findByUserId(applicant.id)),
      Effect.catchAll(() => Effect.succeed(null))
    );
    const applicantName = profile ? fullName(profile, applicant.name) : applicant.name;
    const mailer = yield* Mailer;
    yield* sendMailBestEffort(
      'vouch request',
      mailer.sendVouchRequest({
        email: voucher.email,
        applicantName,
        relationship: input.relationship,
        link: new URL(
          voucherRole === 'family' ? '/family/vouches' : '/service-provider/vouches',
          context.uiOrigin
        ).toString()
      })
    );
    yield* publishNotificationBestEffort(voucher.id, {
      type: 'vouch.requested',
      payload: { vouchId: created.id, applicantName }
    });

    return toApplicantVouch(
      {
        ...created,
        voucher: {
          name: voucher.name,
          email: voucher.email,
          firstName: null,
          lastName: null,
          ...standing
        }
      },
      now
    );
  });

export const listMyVouchesProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const vouchRepo = yield* VouchRepo;
    const vouches = yield* vouchRepo
      .listForApplicants([userAndSession.user.id])
      .pipe(Effect.mapError(repoError));
    const now = new Date();
    return {
      vouches: vouches.map((vouch) => toApplicantVouch(vouch, now)),
      counting: summariseVouches(vouches, now).counting,
      recommended: RECOMMENDED_VOUCHES
    };
  });

export const listVouchRequestsProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const vouchRepo = yield* VouchRepo;
    const requests = yield* vouchRepo
      .listForVoucher(userAndSession.user.id)
      .pipe(Effect.mapError(repoError));
    const now = new Date();
    return {
      requests: requests.map((vouch) => ({
        id: vouch.id,
        applicantName: fullName(vouch.applicant, vouch.applicant.name),
        applicantImage: vouch.applicant.image,
        relationship: vouch.relationship,
        status: presentedVouchStatus(vouch, now),
        requestedAt: vouch.createdAt.toISOString(),
        expiresAt: vouch.expiresAt.toISOString()
      }))
    };
  });

const notifyApplicant = (applicantUserId: string) =>
  publishNotificationBestEffort(applicantUserId, { type: 'vouch.updated', payload: {} });

export const submitVouchProgram = (
  userAndSession: UserAndSession,
  vouchId: string,
  input: VouchSubmitInput,
  submittedIp: string | null
) =>
  Effect.gen(function* () {
    const vouch = yield* loadVoucherOwned(vouchId, userAndSession.user.id);
    const now = new Date();
    const updated = yield* VouchRepo.pipe(
      Effect.flatMap((repo) =>
        repo.transition({
          id: vouch.id,
          from: ['pending'],
          notExpired: true,
          voucherUserId: userAndSession.user.id,
          set: {
            status: 'accepted',
            answers: {
              howKnow: input.howKnow,
              howLong: input.howLong,
              wouldTrust: input.wouldTrust,
              hasConcerns: input.hasConcerns,
              concernsDetail: input.concernsDetail ?? null,
              wouldHire: input.wouldHire,
              anythingElse: input.anythingElse ?? null
            },
            attestedAt: now,
            submittedIp,
            decidedAt: now
          }
        })
      ),
      Effect.mapError(repoError)
    );
    if (!updated) {
      return yield* Effect.fail(new VouchStateError());
    }
    yield* notifyApplicant(vouch.applicantUserId);
    return { id: updated.id, status: 'accepted' as const };
  });

export const declineVouchProgram = (userAndSession: UserAndSession, vouchId: string) =>
  Effect.gen(function* () {
    const vouch = yield* loadVoucherOwned(vouchId, userAndSession.user.id);
    const updated = yield* VouchRepo.pipe(
      Effect.flatMap((repo) =>
        repo.transition({
          id: vouch.id,
          from: ['pending'],
          notExpired: true,
          voucherUserId: userAndSession.user.id,
          set: { status: 'declined', decidedAt: new Date() }
        })
      ),
      Effect.mapError(repoError)
    );
    if (!updated) {
      return yield* Effect.fail(new VouchStateError());
    }
    yield* notifyApplicant(vouch.applicantUserId);
    return { id: updated.id, status: 'declined' as const };
  });

export const withdrawVouchProgram = (userAndSession: UserAndSession, vouchId: string) =>
  Effect.gen(function* () {
    const vouch = yield* loadVoucherOwned(vouchId, userAndSession.user.id);
    if (vouch.status !== 'accepted') {
      return yield* Effect.fail(new VouchStateError());
    }
    // Once the applicant is approved the endorsement is part of that decision;
    // changing it is a conversation with Poppynz, not a button.
    if (yield* hasLiveApproval(vouch.applicantUserId)) {
      return yield* Effect.fail(new VouchLockedError());
    }
    const updated = yield* VouchRepo.pipe(
      Effect.flatMap((repo) =>
        repo.transition({
          id: vouch.id,
          from: ['accepted'],
          voucherUserId: userAndSession.user.id,
          set: { status: 'revoked', revokedBy: userAndSession.user.id, decidedAt: new Date() }
        })
      ),
      Effect.mapError(repoError)
    );
    if (!updated) {
      return yield* Effect.fail(new VouchStateError());
    }
    yield* notifyApplicant(vouch.applicantUserId);
    return { id: updated.id, status: 'revoked' as const };
  });

export const adminVouchActionProgram = (
  adminUserId: string,
  vouchId: string,
  action: 'flagged' | 'revoked',
  reason: string
) =>
  Effect.gen(function* () {
    const updated = yield* VouchRepo.pipe(
      Effect.flatMap((repo) =>
        repo.transition({
          id: vouchId,
          from: ['pending', 'accepted'],
          set: { status: action, revokedBy: adminUserId, adminReason: reason, decidedAt: new Date() }
        })
      ),
      Effect.mapError(repoError)
    );
    if (!updated) {
      return yield* Effect.fail(new VouchStateError());
    }
    yield* notifyApplicant(updated.applicantUserId);
    return { id: updated.id, status: action };
  });

// ---------------------------------------------------------------------------
// Route programs

const authed = (headers: Headers, permission: 'read' | 'write' | 'review') =>
  authenticate(headers).pipe(
    Effect.flatMap((authenticated) =>
      requirePermissions(headers, { vouch: [permission] })(authenticated)
    )
  );

/** First hop of the forwarded chain — same rule as the webhook log. */
const sourceIpOf = (c: HonoContext<HonoEnv>): string | null => {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || c.req.header('x-real-ip') || c.req.header('cf-connecting-ip') || null;
};

export const listMyVouchesRouteProgram = (headers: Headers) =>
  authed(headers, 'read').pipe(Effect.flatMap(listMyVouchesProgram));

export const requestVouchRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const input = yield* validateVouchRequestInput(yield* parseJsonBody(c, vouchJsonError));
    const userAndSession = yield* authed(headers, 'write');
    return yield* requestVouchProgram(userAndSession, input, {
      uiOrigin: resolveUiOrigin(headers)
    });
  });

export const listVouchRequestsRouteProgram = (headers: Headers) =>
  authed(headers, 'read').pipe(Effect.flatMap(listVouchRequestsProgram));

export const submitVouchRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const input = yield* validateVouchSubmitInput(yield* parseJsonBody(c, vouchJsonError));
    const userAndSession = yield* authed(headers, 'write');
    return yield* submitVouchProgram(userAndSession, c.req.param('id') ?? '', input, sourceIpOf(c));
  });

export const declineVouchRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  authed(headers, 'write').pipe(
    Effect.flatMap((userAndSession) => declineVouchProgram(userAndSession, c.req.param('id') ?? ''))
  );

export const withdrawVouchRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  authed(headers, 'write').pipe(
    Effect.flatMap((userAndSession) => withdrawVouchProgram(userAndSession, c.req.param('id') ?? ''))
  );

export const adminVouchActionRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  action: 'flagged' | 'revoked'
) =>
  Effect.gen(function* () {
    const input = yield* validateVouchAdminActionInput(yield* parseJsonBody(c, vouchJsonError));
    const userAndSession = yield* authed(headers, 'review');
    return yield* adminVouchActionProgram(
      userAndSession.user.id,
      c.req.param('id') ?? '',
      action,
      input.reason
    );
  });

export type VouchRouteError =
  | Effect.Effect.Error<ReturnType<typeof listMyVouchesRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof requestVouchRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listVouchRequestsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof submitVouchRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof declineVouchRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof withdrawVouchRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof adminVouchActionRouteProgram>>;

const vouchErrorToResponse = (c: HonoContext<HonoEnv>, error: VouchRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'VouchRepoError':
      return c.json(
        { error: { code: 'VOUCH_LOOKUP_FAILED' as const, message: 'Unable to process the vouch.' } },
        500
      );
    case 'VouchApplicantOnlyError':
      return c.json(
        { error: { code: 'VOUCH_APPLICANT_ONLY' as const, message: 'Only helpers can ask for vouches.' } },
        403
      );
    case 'VoucherUnavailableError':
      return c.json(
        {
          error: {
            code: 'VOUCHER_UNAVAILABLE' as const,
            message: "We couldn't send a request to that email. Check it belongs to an approved Poppynz member."
          }
        },
        422
      );
    case 'VouchAlreadyRequestedError':
      return c.json(
        {
          error: {
            code: 'VOUCH_ALREADY_REQUESTED' as const,
            message: 'You already have an open request with this person.'
          }
        },
        409
      );
    case 'VouchNotFoundError':
      return c.json(
        { error: { code: 'VOUCH_NOT_FOUND' as const, message: 'This vouch request was not found.' } },
        404
      );
    case 'VouchStateError':
      return c.json(
        {
          error: {
            code: 'VOUCH_STATE_INVALID' as const,
            message: 'This vouch request has already been answered or has expired.'
          }
        },
        409
      );
    case 'VouchLockedError':
      return c.json(
        {
          error: {
            code: 'VOUCH_LOCKED' as const,
            message: 'This helper is already approved. Contact Poppynz to change your vouch.'
          }
        },
        409
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, VouchRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return vouchErrorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

const run = async <T>(
  c: HonoContext<HonoEnv>,
  program: Effect.Effect<T, VouchRouteError, never>
) => exitToResponse(c, await c.get('runtime').runPromiseExit(program as never));

export const listMyVouchesHandler = (c: HonoContext<HonoEnv>) =>
  run(c, listMyVouchesRouteProgram(c.req.raw.headers) as never);
export const requestVouchHandler = (c: HonoContext<HonoEnv>) =>
  run(c, requestVouchRouteProgram(c, c.req.raw.headers) as never);
export const listVouchRequestsHandler = (c: HonoContext<HonoEnv>) =>
  run(c, listVouchRequestsRouteProgram(c.req.raw.headers) as never);
export const submitVouchHandler = (c: HonoContext<HonoEnv>) =>
  run(c, submitVouchRouteProgram(c, c.req.raw.headers) as never);
export const declineVouchHandler = (c: HonoContext<HonoEnv>) =>
  run(c, declineVouchRouteProgram(c, c.req.raw.headers) as never);
export const withdrawVouchHandler = (c: HonoContext<HonoEnv>) =>
  run(c, withdrawVouchRouteProgram(c, c.req.raw.headers) as never);
export const flagVouchHandler = (c: HonoContext<HonoEnv>) =>
  run(c, adminVouchActionRouteProgram(c, c.req.raw.headers, 'flagged') as never);
export const revokeVouchHandler = (c: HonoContext<HonoEnv>) =>
  run(c, adminVouchActionRouteProgram(c, c.req.raw.headers, 'revoked') as never);
```

> **Type note:** the `as never` casts in `run` throw away the per-route success type that Hono RPC needs. If the web client in Task 6 sees `unknown` data, replace the `run` helper with one explicit `async function xHandler(c)` per route, each calling `c.get('runtime').runPromiseExit(...)` and `exitToResponse(c, exit)`, as `referrals.handler.ts:286-298` does. That explicit form is the house style and the safe default; prefer it from the start.

`unexpectedDBNotFound`: `DBNotFoundError` is imported for typing only. Remove the import if lint flags it as unused.

- [ ] **Step 8: Routes and wiring**

`apps/api/src/routes/app/vouches/vouches.ts`:

```ts
import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  declineVouchHandler,
  listMyVouchesHandler,
  listVouchRequestsHandler,
  requestVouchHandler,
  submitVouchHandler,
  withdrawVouchHandler
} from './vouches.handler';

export const vouchesRoute = new Hono<HonoEnv>()
  .get('/mine', (c) => listMyVouchesHandler(c))
  .get('/requests', (c) => listVouchRequestsHandler(c))
  .post('/', (c) => requestVouchHandler(c))
  .post('/:id/submit', (c) => submitVouchHandler(c))
  .post('/:id/decline', (c) => declineVouchHandler(c))
  .post('/:id/withdraw', (c) => withdrawVouchHandler(c));
```

`apps/api/src/routes/app/admin/vouches.ts`:

```ts
import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import { flagVouchHandler, revokeVouchHandler } from '../vouches/vouches.handler';

export const adminVouchesRoute = new Hono<HonoEnv>()
  .post('/:id/flag', (c) => flagVouchHandler(c))
  .post('/:id/revoke', (c) => revokeVouchHandler(c));
```

In `apps/api/src/routes/app/index.ts`, import both and add after `.route('/referrals', referralsRoute)`:

```ts
  .route('/vouches', vouchesRoute)
  .route('/admin/vouches', adminVouchesRoute)
```

In `apps/api/src/managed-runtime.ts`, import `VouchRepoDefault` and add it to the layer list next to `ReferralRepoDefault`. In `apps/api/src/app-env.ts`, import `VouchRepo` and add `| VouchRepo` next to `| ReferralRepo`.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd apps/api && bunx vitest run src/routes/app/vouches/vouches.unit.test.ts src/lib/vouches.unit.test.ts`
Expected: PASS.

Run: `cd apps/api && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/mail packages/notify apps/api/src
git commit -m "feat(api): vouch requests, answers, withdrawal and admin flag/revoke"
```

---

### Task 4: Approval-request additions (queue summary, detail vouches, General remarks)

**Files:**
- Modify: `apps/api/src/routes/app/approval-requests/approval-requests.handler.ts`
- Modify: `apps/api/src/routes/app/approval-requests/approval-requests.validator.ts`
- Modify: `apps/api/src/routes/app/admin/approval-requests.ts`
- Test: `apps/api/src/routes/app/approval-requests/approval-requests.unit.test.ts`

**Interfaces:**
- Consumes: `VouchRepo.listForApplicants`, `summariseVouches`, `toAdminVouch`, `ApprovalRequestRepo.updateGeneralRemarks`.
- Produces:
  - Each queue entry gains `vouches: { counting: number; hasConcern: boolean }` and `hasGeneralRemarks: boolean`.
  - The detail response gains `vouches: Array<ReturnType<typeof toAdminVouch>>`, plus `generalRemarks`, `generalRemarksUpdatedAt` and `generalRemarksUpdatedBy`, all on `approvalRequest`.
  - New route `PUT /admin/approval-requests/:id/remarks`, body `{ generalRemarks: string }` (empty clears it), returning the updated request.

- [ ] **Step 1: Write the failing tests**

Append to `approval-requests.unit.test.ts`. Reuse that file's existing `makeLayer`, but extend it with a `vouches?: Array<VouchWithVoucher>` option wired to `makeVouchRepoTest({...EmptyVouchRepo implementation, listForApplicants: () => Effect.succeed(options.vouches ?? [])})`. Also add an `onUpdateRemarks` option wired into the `ApprovalRequestRepo` test's `updateGeneralRemarks`. Then add:

```ts
describe('admin approval queue — vouches', () => {
  it('summarises counting vouches and remarks per helper', async () => {
    const result = await Effect.runPromise(
      listAdminApprovalRequestsRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ vouches: [acceptedVouchFor('provider-1', 'v-1'), acceptedVouchFor('provider-1', 'v-2')] }))
      )
    );
    expect(result.requests[0]).toMatchObject({
      vouches: { counting: 2, hasConcern: false },
      hasGeneralRemarks: false
    });
  });
});

describe('PUT /admin/approval-requests/:id/remarks', () => {
  it('stores trimmed remarks, and an empty string clears them', async () => {
    const calls: Array<[string, string | null, string]> = [];
    await Effect.runPromise(
      updateGeneralRemarksRouteProgram(
        contextWithJson({ generalRemarks: '  Spoke on Tuesday, warm and clear.  ' }),
        new Headers(),
        'request-1'
      ).pipe(Effect.provide(makeLayer({ onUpdateRemarks: (...args) => calls.push(args) })))
    );
    await Effect.runPromise(
      updateGeneralRemarksRouteProgram(contextWithJson({ generalRemarks: '' }), new Headers(), 'request-1').pipe(
        Effect.provide(makeLayer({ onUpdateRemarks: (...args) => calls.push(args) }))
      )
    );
    expect(calls[0][1]).toBe('Spoke on Tuesday, warm and clear.');
    expect(calls[1][1]).toBeNull();
  });
});
```

Define `acceptedVouchFor(applicantUserId, voucherUserId)` in the test file: `dummyVouch` with `status: 'accepted'`, answers with `hasConcerns: false`, and a voucher in good standing. Build it the same way as the `entry()` helper in Task 2. If the file has no `contextWithJson`, copy it from `referrals.unit.test.ts:85`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bunx vitest run src/routes/app/approval-requests/approval-requests.unit.test.ts`
Expected: FAIL. `updateGeneralRemarksRouteProgram` is not exported, and `vouches` is undefined.

- [ ] **Step 3: Implement**

Validator, appended to `approval-requests.validator.ts`:

```ts
export const generalRemarksSchema = Schema.Struct({
  generalRemarks: Schema.Trim.pipe(Schema.maxLength(5000))
});
export const validateGeneralRemarksInput = validateInput(
  generalRemarksSchema,
  approvalRequestValidationError
);
```

Handler changes in `approval-requests.handler.ts`:

1. Imports: add `VouchRepo` from `@repo/db`, `summariseVouches` from `@/api/lib/vouches`, `toAdminVouch` from `../vouches/vouches.handler`, and `validateGeneralRemarksInput`.
2. `toRequestResponse`: widen the generic to also serialise `generalRemarksUpdatedAt`:

```ts
const toRequestResponse = <
  T extends {
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    generalRemarksUpdatedAt: Date | null;
  }
>(
  request: T
) => ({
  ...request,
  reviewedAt: request.reviewedAt?.toISOString() ?? null,
  createdAt: request.createdAt.toISOString(),
  updatedAt: request.updatedAt.toISOString(),
  generalRemarksUpdatedAt: request.generalRemarksUpdatedAt?.toISOString() ?? null
});
```

3. In `listAdminApprovalRequestsRouteProgram`, after `warningsByUser`:

```ts
    // Vouches only apply to helpers; one query for the whole page.
    const helperIds = [...roleByUser.entries()]
      .filter(([, role]) => role === 'service-provider')
      .map(([userId]) => userId);
    const vouchRepo = yield* VouchRepo;
    const vouches = yield* vouchRepo.listForApplicants(helperIds);
    const now = new Date();
    const vouchesByUser = new Map(
      helperIds.map((userId) => [
        userId,
        summariseVouches(
          vouches.filter((vouch) => vouch.applicantUserId === userId),
          now
        )
      ])
    );
```

and in the mapped entry add:

```ts
        vouches: vouchesByUser.get(request.userId) ?? { counting: 0, hasConcern: false },
        hasGeneralRemarks: (request.generalRemarks ?? '').trim().length > 0,
```

4. In `getAdminApprovalRequestRouteProgram`, add one more element to the existing `Effect.all`:

```ts
        role === 'service-provider'
          ? VouchRepo.pipe(Effect.flatMap((repo) => repo.listForApplicants([request.userId])))
          : Effect.succeed([])
```

Destructure it as `vouches`, and add to the response:

```ts
      vouches: vouches.map((vouch) => toAdminVouch(vouch, new Date())),
```

5. New program:

```ts
export const updateGeneralRemarksRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  id: string
) =>
  Effect.gen(function* () {
    const input = yield* validateGeneralRemarksInput(
      yield* parseJsonBody(c, approvalRequestJsonError)
    );
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { approvalRequest: ['write'] })(
      authenticated
    );
    const repo = yield* ApprovalRequestRepo;
    const request = yield* repo.updateGeneralRemarks(
      id,
      input.generalRemarks.length > 0 ? input.generalRemarks : null,
      userAndSession.user.id
    );
    return toRequestResponse(request);
  });
```

Add it to `ApprovalRequestsRouteError`, and add the handler:

```ts
export async function updateGeneralRemarksHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(
    updateGeneralRemarksRouteProgram(c, c.req.raw.headers, id)
  );
  return exitToResponse(c, exit);
}
```

6. In `apps/api/src/routes/app/admin/approval-requests.ts`, add `.put('/:id/remarks', (c) => updateGeneralRemarksHandler(c))`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bunx vitest run src/routes/app/approval-requests && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/app/approval-requests apps/api/src/routes/app/admin/approval-requests.ts
git commit -m "feat(api): vouch summary and general remarks on approval requests"
```

---

### Task 5: Recipient / counterpart approval checks

**Files:**
- Modify: `apps/api/src/lib/approval-gate.ts`
- Modify: `apps/api/src/routes/app/conversations/conversations.handler.ts` (~line 247)
- Modify: `apps/api/src/routes/app/contracts/contracts.handler.ts` (route programs ~1009/1061/1082, programs ~584/690, error map ~1267)
- Test: `apps/api/src/routes/app/conversations/conversations.unit.test.ts`, `apps/api/src/routes/app/contracts/contracts.unit.test.ts`

**Interfaces:**
- Produces: `requireCounterpartApproval(counterpart: Pick<User, 'id' | 'banned' | 'banExpires'>): Effect<void, CounterpartNotApprovedError | ApprovalGateUnavailableError, ApprovalRepo>`; `CounterpartNotApprovedError`; new contract error code `COUNTERPART_UNAVAILABLE` (409).

- [ ] **Step 1: Write the failing tests**

In `conversations.unit.test.ts`, inside `describe('POST /conversations (reach-out)')`:

```ts
  it('treats an unapproved recipient as not found', async () => {
    const exit = await Effect.runPromiseExit(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: 'provider-1', serviceIds: [offeredService().id] } }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ viewer: familyUser(), counterpart: providerUser(), providerApproved: false })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'RecipientNotFoundError' });
  });

  it('treats a banned recipient as not found', async () => {
    const exit = await Effect.runPromiseExit(
      createReachoutRouteProgram(
        makeContext({ body: { recipientUserId: 'provider-1', serviceIds: [offeredService().id] } }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ viewer: familyUser(), counterpart: providerUser({ banned: true, banExpires: null }) })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'RecipientNotFoundError' });
  });
```

In `contracts.unit.test.ts`, add to `makeLayer`'s options `familyApproved?: boolean; providerApproved?: boolean;`. Add to its `Layer.mergeAll`, copying the block from `conversations.unit.test.ts:258-267`:

```ts
    makeApprovalRepoTest({
      findCurrentByUserId: (userId) => {
        const approved =
          userId === familyUser().id
            ? (options.familyApproved ?? true)
            : (options.providerApproved ?? true);
        return approved
          ? Effect.succeed({ id: `approval-${userId}`, userId, status: 'approved', expiresAt: new Date('2099-01-01') } as never)
          : Effect.fail(new DBNotFoundError({ entity: 'approval', value: userId }));
      }
    }),
```

Then add tests. Use the file's existing send/accept fixtures: find the passing "send" and "accept" tests and copy their arguments and options.

```ts
describe('contract approval gates', () => {
  it('blocks sending terms to a provider without a live approval', async () => {
    // same setup as the existing successful send test, plus providerApproved: false
    expect(failure).toMatchObject({ _tag: 'CounterpartNotApprovedError' });
  });
  it('blocks a family without a live approval from sending terms', async () => {
    // same setup, familyApproved: false
    expect(failure).toMatchObject({ _tag: 'ApprovalRequiredError', role: 'family' });
  });
  it('blocks accepting terms proposed by a family that lost its approval', async () => {
    // same setup as the existing successful accept test (viewer = provider), familyApproved: false
    expect(failure).toMatchObject({ _tag: 'CounterpartNotApprovedError' });
  });
});
```

Write each test body in full by copying the matching existing success test and changing only the option and the assertion. Do not leave the comments in.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bunx vitest run src/routes/app/conversations src/routes/app/contracts`
Expected: the new tests FAIL. Reach-out succeeds instead of failing, and contracts don't fail.

- [ ] **Step 3: Implement the gate helper**

Append to `apps/api/src/lib/approval-gate.ts`. Add `type User` to the `@repo/db` import.

```ts
/** The other side of a reach-out or contract has no live approval (or is
 * banned). Routes decide how much to reveal: reach-out maps this to "not
 * found", a contract inside an existing conversation says so plainly. */
export class CounterpartNotApprovedError extends Data.TaggedError(
  'CounterpartNotApprovedError'
)<{}> {}

export const requireCounterpartApproval = (
  counterpart: Pick<User, 'id' | 'banned' | 'banExpires'>
) =>
  Effect.gen(function* () {
    const now = new Date();
    if (
      counterpart.banned === true &&
      (counterpart.banExpires === null || counterpart.banExpires > now)
    ) {
      return yield* Effect.fail(new CounterpartNotApprovedError());
    }
    const repo = yield* ApprovalRepo;
    yield* repo.findCurrentByUserId(counterpart.id).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.fail(new CounterpartNotApprovedError()),
        SqlError: () => Effect.fail(new ApprovalGateUnavailableError())
      })
    );
  });
```

- [ ] **Step 4: Reach-out**

In `conversations.handler.ts`, directly after `yield* requireLiveApproval(userAndSession);` in `createReachoutProgram`:

```ts
    // The recipient must be live too — an unapproved or banned person is
    // indistinguishable from one who doesn't exist, so nobody can probe status.
    yield* requireCounterpartApproval(recipient).pipe(
      Effect.catchTag('CounterpartNotApprovedError', () =>
        Effect.fail(new RecipientNotFoundError())
      )
    );
```

Import `requireCounterpartApproval` alongside `requireLiveApproval`.

- [ ] **Step 5: Contracts**

In `contracts.handler.ts`:
1. Import `requireLiveApproval`, `requireCounterpartApproval`, `approvalRequiredResponseBody` and `approvalGateUnavailableResponseBody` from `@/api/lib/approval-gate`, and `UserRepo` from `@repo/db` if it isn't already imported.
2. In `createContractRouteProgram`, `sendContractRouteProgram` and `acceptContractRouteProgram`, add `yield* requireLiveApproval(userAndSession);` right after `yield* requireVerifiedSafety(userAndSession);`.
3. Add a helper near `loadParticipantContract`:

```ts
/** Contracts are bookings: the person on the other side must still hold a
 * live approval when terms are sent or accepted. */
const requireContractCounterpart = (counterpartUserId: string) =>
  UserRepo.pipe(
    Effect.flatMap((repo) => repo.findById(counterpartUserId)),
    Effect.catchTag('DBNotFoundError', () => Effect.fail(new CounterpartNotApprovedError())),
    (errors) => mapContractRepoError(errors),
    Effect.flatMap(requireCounterpartApproval)
  );
```

If `mapContractRepoError` doesn't accept this error union, map `SqlError` explicitly with `Effect.catchTag('SqlError', ...)`, following the file's existing pattern.

4. In `sendContractProgram`, after the `EmptyContractTermsError` check, add `yield* requireContractCounterpart(contract.providerUserId);`.
5. In `acceptContractProgram`, after the `ContractProposalExpiredError` check, add `yield* requireContractCounterpart(pending.proposedByUserId);`.
6. In the contract error-to-response switch, before `default`:

```ts
    case 'ApprovalRequiredError':
      return c.json(
        {
          error: approvalRequiredResponseBody(
            error.role,
            'You need a current approval to send or accept contract terms.'
          )
        },
        403
      );
    case 'ApprovalGateUnavailableError':
      return c.json({ error: approvalGateUnavailableResponseBody }, 503);
    case 'CounterpartNotApprovedError':
      return c.json(
        {
          error: {
            code: 'COUNTERPART_UNAVAILABLE' as const,
            message: "The other person can't take on new contracts right now."
          }
        },
        409
      );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && bunx vitest run src/routes/app/conversations src/routes/app/contracts && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: PASS. Existing tests still pass, because the approval defaults are `true`.

- [ ] **Step 7: Web copy for the new contract code**

In `apps/web/src/lib/components/contracts/ContractDetailPage.svelte`, in `actionErrorToast` (~line 199), add a branch before the fallback:

```ts
		} else if (error.code === 'COUNTERPART_UNAVAILABLE') {
			toast.error("The other person can't take on new contracts right now.");
```

Then run `cd apps/web && bun run check`. If any exhaustive `matchError(...)` over contract or reach-out endpoints now reports missing codes (`COUNTERPART_UNAVAILABLE`, `FAMILY_NOT_APPROVED`, `PROVIDER_NOT_APPROVED`, `APPROVAL_UNAVAILABLE`), add entries returning the same messages as the API.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src apps/web/src/lib/components/contracts
git commit -m "fix(api): require the recipient's and counterpart's live approval for reach-outs and contracts"
```

---

### Task 6: Web — applicant vouches panel and the submit nudge

**Files:**
- Create: `apps/web/src/lib/api/vouches.ts`
- Create: `apps/web/src/lib/components/vouches/ApplicantVouchesPanel.svelte`
- Modify: `apps/web/src/routes/service-provider/verification/+page.svelte`
- Modify: `apps/web/src/lib/components/verification/ApprovalPanel.svelte`

**Interfaces:**
- Consumes: Task 3 routes (after `bun run build` in `apps/api`).
- Produces: `getMyVouches()`, `requestVouch({email, relationship})`, `listVouchRequests()`, `submitVouch(id, answers)`, `declineVouch(id)`, `withdrawVouch(id)`; types `MyVouches`, `MyVouch`, `VouchRequestList`, `VouchRequestEntry`, `VouchAnswersInput`. `ApprovalPanel` gains the optional prop `vouchCount?: number | null`.

- [ ] **Step 1: API client**

`apps/web/src/lib/api/vouches.ts`:

```ts
/** Vouches — a helper asks approved members to vouch; members answer. */
import { apiClient, call, type ErrorsOf } from './client';

const mineEndpoint = apiClient.vouches.mine.$get;
const requestEndpoint = apiClient.vouches.$post;
const incomingEndpoint = apiClient.vouches.requests.$get;
const submitEndpoint = apiClient.vouches[':id'].submit.$post;
const declineEndpoint = apiClient.vouches[':id'].decline.$post;
const withdrawEndpoint = apiClient.vouches[':id'].withdraw.$post;

export type MyVouches = Extract<Awaited<ReturnType<typeof getMyVouches>>, { ok: true }>['data'];
export type MyVouch = MyVouches['vouches'][number];
export type VouchRequestList = Extract<
	Awaited<ReturnType<typeof listVouchRequests>>,
	{ ok: true }
>['data'];
export type VouchRequestEntry = VouchRequestList['requests'][number];
export type VouchRequestError = ErrorsOf<typeof requestEndpoint>;

export type VouchAnswersInput = {
	howKnow: string;
	howLong: string;
	wouldTrust: 'yes' | 'no' | 'unsure';
	hasConcerns: boolean;
	concernsDetail: string | null;
	wouldHire: 'yes' | 'no' | 'unsure';
	anythingElse: string | null;
	attested: true;
};

export async function getMyVouches() {
	return call(mineEndpoint());
}

export async function requestVouch(input: { email: string; relationship: string }) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { json: input } as unknown as Parameters<typeof requestEndpoint>[0];
	return call(requestEndpoint(args));
}

export async function listVouchRequests() {
	return call(incomingEndpoint());
}

export async function submitVouch(id: string, answers: VouchAnswersInput) {
	const args = { param: { id }, json: answers } as unknown as Parameters<typeof submitEndpoint>[0];
	return call(submitEndpoint(args));
}

export async function declineVouch(id: string) {
	return call(declineEndpoint({ param: { id } }));
}

export async function withdrawVouch(id: string) {
	return call(withdrawEndpoint({ param: { id } }));
}
```

- [ ] **Step 2: `ApplicantVouchesPanel.svelte`**

`apps/web/src/lib/components/vouches/ApplicantVouchesPanel.svelte`:

```svelte
<script lang="ts">
	/** A helper's vouch requests: ask an approved member by email, then track
	 * each request. Answers and the reason a vouch stopped counting are never
	 * shown here — "Not counted" is all the applicant learns. */
	import { matchError } from '$lib/api/client';
	import { requestVouch, type MyVouch, type MyVouches } from '$lib/api/vouches';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		data: MyVouches;
		onchanged: () => Promise<void>;
	}

	let { data, onchanged }: Props = $props();

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let email = $state('');
	let relationship = $state('');
	let sending = $state(false);
	let formError = $state('');

	const canSend = $derived(email.includes('@') && relationship.trim().length > 0 && !sending);

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (!canSend) return;
		sending = true;
		formError = '';
		const result = await requestVouch({ email, relationship });
		if (result.ok) {
			toast.success('Request sent. We’ve let them know.');
			email = '';
			relationship = '';
			await onchanged();
		} else {
			formError = matchError(result.error, {
				VOUCHER_UNAVAILABLE: () =>
					"We couldn't send a request to that email. Check it belongs to an approved Poppynz member.",
				VOUCH_ALREADY_REQUESTED: () => 'You already have an open request with this person.',
				VOUCH_APPLICANT_ONLY: () => 'Only helpers can ask for vouches.',
				INVALID_VOUCH_INPUT: () => 'Check the email and how you know them, then try again.',
				VOUCH_LOOKUP_FAILED: () => RETRY_MESSAGE,
				UNAUTHORIZED: () => 'You need to be signed in.',
				FORBIDDEN: () => 'You need to be signed in.',
				AUTH_PROVIDER_FAILED: () => RETRY_MESSAGE,
				AUTH_ENTITY_LOOKUP_FAILED: () => RETRY_MESSAGE,
				INTERNAL_SERVER_ERROR: () => RETRY_MESSAGE,
				UNEXPECTED: () => RETRY_MESSAGE
			});
		}
		sending = false;
	}

	const chipClass: Record<MyVouch['status'], string> = {
		pending: 'bg-info-content text-info',
		completed: 'bg-success-content text-success',
		declined: 'bg-base-300 text-base-content-muted',
		expired: 'bg-base-300 text-base-content-muted',
		not_counted: 'bg-warning-content text-warning'
	};
	const chipLabel: Record<MyVouch['status'], string> = {
		pending: 'Pending',
		completed: 'Completed',
		declined: 'Declined',
		expired: 'Expired',
		not_counted: 'Not counted'
	};
</script>

<div class="rounded-lg border border-card-border bg-base-100 p-5 lg:p-6">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<div class="text-[15px] font-bold text-base-content">
			Vouches · {data.counting} of {data.recommended} recommended
		</div>
		{#if data.counting < data.recommended}
			<span class="text-xs text-base-content-muted">
				Optional — without them we'll email you to arrange a quick chat.
			</span>
		{/if}
	</div>
	<p class="mt-1 text-[13px] text-base-content-muted">
		Ask two approved Poppynz members who know you personally — a family or a helper. Their answers
		go only to our team.
	</p>

	<form class="mt-4 flex flex-col gap-2.5" onsubmit={send}>
		<div class="flex flex-col gap-2.5 sm:flex-row">
			<label class="input min-w-0 flex-1">
				<i class="las la-envelope text-base text-outline" aria-hidden="true"></i>
				<input type="email" placeholder="their.email@example.com" required bind:value={email} />
			</label>
			<label class="input min-w-0 flex-1">
				<input
					type="text"
					maxlength="300"
					placeholder="How do you know them? e.g. I nanny for their family"
					required
					bind:value={relationship}
				/>
			</label>
			<button type="submit" class="btn btn-primary" disabled={!canSend}>
				{#if sending}<span class="loading loading-spinner loading-xs"></span>{/if}
				Ask to vouch
			</button>
		</div>
		{#if formError}
			<p role="alert" class="text-sm font-medium text-error">{formError}</p>
		{/if}
	</form>

	{#if data.vouches.length > 0}
		<div class="mt-4 flex flex-col gap-2">
			{#each data.vouches as vouch (vouch.id)}
				<div
					class="flex items-center gap-3 rounded-[10px] border border-card-border px-4 py-3"
				>
					<div class="min-w-0 flex-1">
						<div class="truncate text-[13.5px] font-semibold text-base-content">
							{vouch.voucherName}
						</div>
						<div class="truncate text-[11.5px] text-outline">{vouch.voucherEmail}</div>
					</div>
					<span
						class="rounded-[5px] px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap
							{chipClass[vouch.status]}"
					>
						{chipLabel[vouch.status]}
					</span>
				</div>
			{/each}
		</div>
		{#if data.vouches.some((vouch) => vouch.status === 'not_counted')}
			<p class="mt-2 text-xs text-warning">
				A vouch needs attention and isn't counted. You can ask someone else.
			</p>
		{/if}
	{/if}
</div>
```

- [ ] **Step 3: Verification page wiring**

In `apps/web/src/routes/service-provider/verification/+page.svelte`:
- Import `getMyVouches, type MyVouches` and `ApplicantVouchesPanel`.
- Add `let vouches = $state<MyVouches | null>(null);`.
- In `load()`, add `getMyVouches()` to the `Promise.all` as a fourth item. Require `vouchesResult.ok` in the success check, and set `vouches = vouchesResult.data`.
- Add `notifications.on('vouch.updated', () => void load()),` to the `unsubscribers` array.
- Change the render guard to `{:else if onboarding && safety && history && vouches}`.
- Insert, between the `background-check` section and the `review` section:

```svelte
		<section id="vouches" class="mt-10 scroll-mt-6">
			<h2 class="mb-4 font-display text-lg font-bold text-base-content">Vouches</h2>
			<ApplicantVouchesPanel data={vouches} onchanged={load} />
		</section>
```

- Pass the count to the approval panel: `<ApprovalPanel role="service-provider" hub={onboarding} {history} vouchCount={vouches.counting} onchanged={load} />`.

- [ ] **Step 4: Soft nudge in `ApprovalPanel.svelte`**

- Add `vouchCount?: number | null;` to `Props`, and destructure it as `vouchCount = null`.
- Import `ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte'`.
- Add the state and function:

```ts
	const RECOMMENDED_VOUCHES = 2;
	let nudgeOpen = $state(false);

	/** Vouches are a nudge, never a gate: fewer than recommended asks once,
	 * then submits anyway. Families (vouchCount null) go straight through. */
	function requestSubmit() {
		if (vouchCount !== null && vouchCount < RECOMMENDED_VOUCHES) {
			nudgeOpen = true;
			return;
		}
		void submit();
	}
```

- Replace every `onclick={() => void submit()}` with `onclick={requestSubmit}` (use replace-all).
- At the end of the markup:

```svelte
<ConfirmDialog
	open={nudgeOpen}
	title="Submit without two vouches?"
	body={`You have ${vouchCount ?? 0} of ${RECOMMENDED_VOUCHES} recommended vouches. You can still submit — our team will email you to arrange a quick chat before deciding.`}
	confirmLabel="Submit anyway"
	confirmClass="btn-primary"
	busy={submitting}
	onconfirm={() => {
		nudgeOpen = false;
		void submit();
	}}
	oncancel={() => (nudgeOpen = false)}
/>
```

- [ ] **Step 5: Check**

Run: `cd apps/api && bun run build && cd ../web && bun run check && bun run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): helper vouch requests and the two-vouch nudge on submit"
```

---

### Task 7: Web — the voucher's inbox and form

**Files:**
- Create: `apps/web/src/lib/components/vouches/VouchFormDialog.svelte`
- Create: `apps/web/src/lib/components/vouches/VouchRequestsPage.svelte`
- Create: `apps/web/src/routes/family/vouches/+page.svelte`, `apps/web/src/routes/service-provider/vouches/+page.svelte`
- Modify: `apps/web/src/routes/family/+layout.svelte` (~line 75), `apps/web/src/routes/service-provider/+layout.svelte` (~line 115)
- Modify: `apps/web/src/lib/components/RealtimeNotifications.svelte`

**Interfaces:**
- Consumes: Task 6 client functions.

- [ ] **Step 1: `VouchFormDialog.svelte`**

```svelte
<script lang="ts">
	/** The six-question vouch form plus the mandatory attestation. Emits the
	 * answers; the caller submits and closes. */
	import type { VouchAnswersInput } from '$lib/api/vouches';

	interface Props {
		open: boolean;
		applicantName: string;
		busy?: boolean;
		onconfirm: (answers: VouchAnswersInput) => void;
		oncancel: () => void;
	}

	let { open, applicantName, busy = false, onconfirm, oncancel }: Props = $props();

	type Choice = 'yes' | 'no' | 'unsure';
	let howKnow = $state('');
	let howLong = $state('');
	let wouldTrust = $state<Choice | null>(null);
	let hasConcerns = $state<boolean | null>(null);
	let concernsDetail = $state('');
	let wouldHire = $state<Choice | null>(null);
	let anythingElse = $state('');
	let attested = $state(false);

	$effect(() => {
		if (open) {
			howKnow = '';
			howLong = '';
			wouldTrust = null;
			hasConcerns = null;
			concernsDetail = '';
			wouldHire = null;
			anythingElse = '';
			attested = false;
		}
	});

	const complete = $derived(
		howKnow.trim().length > 0 &&
			howLong.trim().length > 0 &&
			wouldTrust !== null &&
			hasConcerns !== null &&
			(hasConcerns === false || concernsDetail.trim().length > 0) &&
			wouldHire !== null &&
			attested
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!complete || busy || wouldTrust === null || wouldHire === null || hasConcerns === null) return;
		onconfirm({
			howKnow: howKnow.trim(),
			howLong: howLong.trim(),
			wouldTrust,
			hasConcerns,
			concernsDetail: hasConcerns ? concernsDetail.trim() : null,
			wouldHire,
			anythingElse: anythingElse.trim() || null,
			attested: true
		});
	}

	const choices: Array<{ value: Choice; label: string }> = [
		{ value: 'yes', label: 'Yes' },
		{ value: 'no', label: 'No' },
		{ value: 'unsure', label: 'Not sure' }
	];
</script>

{#snippet choiceRow(name: string, value: Choice | null, set: (choice: Choice) => void)}
	<div class="flex gap-2">
		{#each choices as choice (choice.value)}
			<label class="flex items-center gap-1.5 text-sm">
				<input
					type="radio"
					class="radio radio-sm"
					{name}
					checked={value === choice.value}
					onchange={() => set(choice.value)}
				/>
				{choice.label}
			</label>
		{/each}
	</div>
{/snippet}

{#if open}
	<div class="modal modal-open" role="dialog" aria-label="Vouch for {applicantName}">
		<form class="modal-box max-w-xl" onsubmit={submit}>
			<h2 class="text-lg font-bold">Vouch for {applicantName}</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				A vouch is a <b>personal endorsement</b>. Your answers are seen only by the Poppynz team, never
				by {applicantName}.
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">1. How do you know the applicant?</legend>
				<textarea class="textarea w-full" maxlength="1000" bind:value={howKnow}></textarea>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">2. How long have you known them?</legend>
				<input class="input w-full" maxlength="100" bind:value={howLong} placeholder="e.g. 3 years" />
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					3. Would you trust this person to provide care for a child, older adult, pet, or household?
				</legend>
				{@render choiceRow('wouldTrust', wouldTrust, (choice) => (wouldTrust = choice))}
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					4. Do you have any concerns about their reliability, judgment, safety, or conduct?
				</legend>
				<div class="flex gap-2">
					<label class="flex items-center gap-1.5 text-sm">
						<input type="radio" class="radio radio-sm" name="hasConcerns" checked={hasConcerns === false} onchange={() => (hasConcerns = false)} />
						No
					</label>
					<label class="flex items-center gap-1.5 text-sm">
						<input type="radio" class="radio radio-sm" name="hasConcerns" checked={hasConcerns === true} onchange={() => (hasConcerns = true)} />
						Yes
					</label>
				</div>
				{#if hasConcerns}
					<textarea class="textarea mt-2 w-full" maxlength="2000" placeholder="Please tell us more" bind:value={concernsDetail}></textarea>
				{/if}
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">5. Would you personally hire or recommend them?</legend>
				{@render choiceRow('wouldHire', wouldHire, (choice) => (wouldHire = choice))}
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					6. Is there anything Poppynz should know before approving them? · optional
				</legend>
				<textarea class="textarea w-full" maxlength="2000" bind:value={anythingElse}></textarea>
			</fieldset>

			<label class="mt-3 flex items-start gap-2.5 text-[13px] leading-relaxed">
				<input type="checkbox" class="checkbox checkbox-sm mt-0.5" bind:checked={attested} />
				<span>
					I confirm that I know this applicant personally and that the information I have provided is
					truthful. I understand that Poppynz may contact me to verify this referral.
				</span>
			</label>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>Cancel</button>
				<button type="submit" class="btn btn-primary" disabled={!complete || busy}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					Submit vouch
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={oncancel}></button>
	</div>
{/if}
```

- [ ] **Step 2: `VouchRequestsPage.svelte`**

```svelte
<script lang="ts">
	/** Vouch requests sent to the viewer: vouch (form), decline, or withdraw a
	 * vouch already given while the applicant is still unapproved. */
	import { onMount } from 'svelte';
	import {
		declineVouch,
		listVouchRequests,
		submitVouch,
		withdrawVouch,
		type VouchAnswersInput,
		type VouchRequestEntry
	} from '$lib/api/vouches';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import VouchFormDialog from '$lib/components/vouches/VouchFormDialog.svelte';
	import { notifications } from '$lib/notifications.svelte';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let requests = $state<Array<VouchRequestEntry> | null>(null);
	let loadError = $state('');
	let busy = $state(false);
	let formFor = $state<VouchRequestEntry | null>(null);
	let confirm = $state<{ kind: 'decline' | 'withdraw'; entry: VouchRequestEntry } | null>(null);

	async function load() {
		const result = await listVouchRequests();
		if (result.ok) {
			requests = result.data.requests;
			loadError = '';
		} else {
			loadError = RETRY_MESSAGE;
		}
	}

	onMount(() => {
		void load();
		return notifications.on('vouch.requested', () => void load());
	});

	const errorText = (code: string) =>
		code === 'VOUCH_STATE_INVALID'
			? 'This request was already answered or has expired.'
			: code === 'VOUCH_LOCKED'
				? 'This helper is already approved. Contact Poppynz to change your vouch.'
				: RETRY_MESSAGE;

	async function sendVouch(answers: VouchAnswersInput) {
		if (!formFor || busy) return;
		busy = true;
		const result = await submitVouch(formFor.id, answers);
		if (result.ok) {
			toast.success(`Thanks — your vouch for ${formFor.applicantName} is with our team.`);
			formFor = null;
		} else {
			toast.error(errorText(result.error.code));
		}
		busy = false;
		await load();
	}

	async function confirmAction() {
		if (!confirm || busy) return;
		busy = true;
		const result =
			confirm.kind === 'decline'
				? await declineVouch(confirm.entry.id)
				: await withdrawVouch(confirm.entry.id);
		if (result.ok) {
			toast.success(confirm.kind === 'decline' ? 'Request declined.' : 'Vouch withdrawn.');
		} else {
			toast.error(errorText(result.error.code));
		}
		confirm = null;
		busy = false;
		await load();
	}

	const chip: Record<VouchRequestEntry['status'], { label: string; cls: string }> = {
		pending: { label: 'Waiting for you', cls: 'bg-info-content text-info' },
		accepted: { label: 'Vouched', cls: 'bg-success-content text-success' },
		declined: { label: 'Declined', cls: 'bg-base-300 text-base-content-muted' },
		expired: { label: 'Expired', cls: 'bg-base-300 text-base-content-muted' },
		revoked: { label: 'Withdrawn', cls: 'bg-base-300 text-base-content-muted' },
		flagged: { label: 'Under review', cls: 'bg-base-300 text-base-content-muted' }
	};
</script>

<svelte:head>
	<title>Vouch requests · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Vouch requests</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Helpers applying to Poppynz can ask members who know them to vouch. Only vouch for people you
		know personally.
	</p>

	{#if loadError}
		<p role="alert" class="text-sm font-medium text-error">{loadError}</p>
	{:else if requests === null}
		<div class="flex justify-center py-20">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if requests.length === 0}
		<p class="rounded-xl border border-card-border bg-base-100 p-8 text-center text-sm text-base-content-muted">
			No vouch requests yet.
		</p>
	{:else}
		<div class="flex flex-col gap-2">
			{#each requests as entry (entry.id)}
				<div class="flex flex-wrap items-center gap-3 rounded-[10px] border border-card-border bg-base-100 px-4 py-3.5">
					{#if entry.applicantImage}
						<img src={entry.applicantImage} alt="" class="size-10 rounded-full object-cover" />
					{:else}
						<span class="flex size-10 items-center justify-center rounded-full bg-base-400 text-[13px] font-bold text-secondary">
							{entry.applicantName.slice(0, 2).toUpperCase()}
						</span>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="truncate text-[13.5px] font-semibold text-base-content">{entry.applicantName}</div>
						<div class="truncate text-[12px] text-base-content-muted">"{entry.relationship}"</div>
					</div>
					<span class="rounded-[5px] px-2.5 py-1 text-[11px] font-semibold {chip[entry.status].cls}">
						{chip[entry.status].label}
					</span>
					{#if entry.status === 'pending'}
						<button type="button" class="btn btn-primary btn-sm" onclick={() => (formFor = entry)}>Vouch</button>
						<button type="button" class="btn btn-ghost btn-sm" onclick={() => (confirm = { kind: 'decline', entry })}>
							Decline
						</button>
					{:else if entry.status === 'accepted'}
						<button type="button" class="btn btn-ghost btn-sm" onclick={() => (confirm = { kind: 'withdraw', entry })}>
							Withdraw
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<VouchFormDialog
	open={formFor !== null}
	applicantName={formFor?.applicantName ?? ''}
	{busy}
	onconfirm={(answers) => void sendVouch(answers)}
	oncancel={() => (formFor = null)}
/>

<ConfirmDialog
	open={confirm !== null}
	title={confirm?.kind === 'decline' ? 'Decline this request?' : 'Withdraw your vouch?'}
	body={confirm?.kind === 'decline'
		? `${confirm.entry.applicantName} will see that you declined. No reason is shared.`
		: `Your vouch for ${confirm?.entry.applicantName ?? ''} will stop counting.`}
	confirmLabel={confirm?.kind === 'decline' ? 'Decline' : 'Withdraw'}
	{busy}
	onconfirm={() => void confirmAction()}
	oncancel={() => (confirm = null)}
/>
```

- [ ] **Step 3: Route shells and nav**

`apps/web/src/routes/family/vouches/+page.svelte` and `apps/web/src/routes/service-provider/vouches/+page.svelte`, both:

```svelte
<script lang="ts">
	import VouchRequestsPage from '$lib/components/vouches/VouchRequestsPage.svelte';
</script>

<VouchRequestsPage />
```

Family layout: add after the Referrals item:

```ts
		{ href: resolve('/family/vouches'), label: 'Vouch requests', icon: 'la-handshake' }
```

Service-provider layout: add after the Referrals item:

```ts
		{
			href: resolve('/service-provider/vouches'),
			label: 'Vouch requests',
			icon: 'la-handshake',
			group: 'More'
		},
```

- [ ] **Step 4: Realtime toast**

In `RealtimeNotifications.svelte`, add next to the other `notifications.on(...)` handlers:

```ts
			notifications.on('vouch.requested', (event) => {
				if (window.location.pathname.endsWith('/vouches')) return;
				toast.info(`${event.payload.applicantName} asked you to vouch for them.`, {
					title: 'Vouch request'
				});
			}),
```

- [ ] **Step 5: Check**

Run: `cd apps/web && bun run check && bun run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): vouch request inbox with the six-question form"
```

---

### Task 8: Web — admin queue filter, vouches card, General remarks

**Files:**
- Modify: `apps/web/src/lib/api/admin-approvals.ts`
- Create: `apps/web/src/lib/components/admin/VouchActionDialog.svelte`
- Create: `apps/web/src/lib/components/admin/VouchesCard.svelte`
- Create: `apps/web/src/lib/components/admin/GeneralRemarksCard.svelte`
- Modify: `apps/web/src/routes/admin/approval-requests/+page.svelte`
- Modify: `apps/web/src/routes/admin/approval-requests/[id]/+page.svelte`

**Interfaces:**
- Consumes: Task 3 admin vouch routes; Task 4 remarks route and response fields.

- [ ] **Step 1: Client additions**

Append to `apps/web/src/lib/api/admin-approvals.ts`:

```ts
const remarksEndpoint = apiClient.admin['approval-requests'][':id'].remarks.$put;
const flagVouchEndpoint = apiClient.admin.vouches[':id'].flag.$post;
const revokeVouchEndpoint = apiClient.admin.vouches[':id'].revoke.$post;

export type AdminVouch = ApprovalRequestDetail['vouches'][number];

export async function saveGeneralRemarks(id: string, generalRemarks: string) {
	const args = { param: { id }, json: { generalRemarks } } as unknown as Parameters<
		typeof remarksEndpoint
	>[0];
	return call(remarksEndpoint(args));
}

export async function actOnVouch(id: string, action: 'flag' | 'revoke', reason: string) {
	const endpoint = action === 'flag' ? flagVouchEndpoint : revokeVouchEndpoint;
	const args = { param: { id }, json: { reason } } as unknown as Parameters<typeof endpoint>[0];
	return call(endpoint(args));
}
```

- [ ] **Step 2: `VouchActionDialog.svelte`**

This follows `RejectRequestDialog.svelte`, but the reason is admin-only:

```svelte
<script lang="ts">
	/** Flag or revoke a vouch. The reason is for the admin team only — the
	 * applicant sees "Not counted", never this text. */
	interface Props {
		action: 'flag' | 'revoke' | null;
		voucherName: string;
		busy?: boolean;
		onconfirm: (reason: string) => void;
		oncancel: () => void;
	}

	let { action, voucherName, busy = false, onconfirm, oncancel }: Props = $props();

	let reason = $state('');

	$effect(() => {
		if (action) reason = '';
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (reason.trim().length === 0 || busy) return;
		onconfirm(reason.trim());
	}
</script>

{#if action}
	<div class="modal modal-open" role="dialog" aria-label="{action} vouch">
		<form class="modal-box" onsubmit={submit}>
			<h2 class="text-lg font-bold">
				{action === 'flag' ? 'Flag' : 'Revoke'} {voucherName}'s vouch
			</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				The vouch stops counting. The applicant only sees "Not counted" — this reason stays internal.
			</p>
			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">Reason · required</legend>
				<textarea class="textarea min-h-20 w-full" maxlength="500" bind:value={reason}></textarea>
			</fieldset>
			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>Cancel</button>
				<button type="submit" class="btn btn-error text-error-content" disabled={reason.trim().length === 0 || busy}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{action === 'flag' ? 'Flag vouch' : 'Revoke vouch'}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={oncancel}></button>
	</div>
{/if}
```

- [ ] **Step 3: `VouchesCard.svelte`**

```svelte
<script lang="ts">
	/** Admin-only view of a helper's vouches, answers included. */
	import { actOnVouch, type AdminVouch } from '$lib/api/admin-approvals';
	import VouchActionDialog from '$lib/components/admin/VouchActionDialog.svelte';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		vouches: Array<AdminVouch>;
		onchanged: () => Promise<void>;
	}

	let { vouches, onchanged }: Props = $props();

	let acting = $state<{ vouch: AdminVouch; action: 'flag' | 'revoke' } | null>(null);
	let busy = $state(false);

	const counting = $derived(vouches.filter((vouch) => vouch.counts).length);

	async function confirm(reason: string) {
		if (!acting || busy) return;
		busy = true;
		const result = await actOnVouch(acting.vouch.id, acting.action, reason);
		if (result.ok) {
			toast.success(acting.action === 'flag' ? 'Vouch flagged.' : 'Vouch revoked.');
			acting = null;
			await onchanged();
		} else {
			toast.error('That vouch has already changed — reloading.');
			acting = null;
			await onchanged();
		}
		busy = false;
	}

	const answerLabel = { yes: 'Yes', no: 'No', unsure: 'Not sure' } as const;
	const formatDate = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<div class="rounded-lg border border-card-border bg-base-100 p-5">
	<div class="mb-3 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
		Vouches · {counting} of 2 recommended
	</div>
	{#if vouches.length === 0}
		<p class="py-2 text-[13px] text-base-content-muted">No vouch requests yet — arrange a chat.</p>
	{:else}
		<div class="flex flex-col gap-3">
			{#each vouches as vouch (vouch.id)}
				<div class="rounded-[10px] border border-card-border p-3.5">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-[13.5px] font-semibold text-base-content">{vouch.voucher.name}</span>
						<span class="text-[11.5px] text-outline">
							{vouch.voucher.role === 'family' ? 'Family' : 'Helper'} · {vouch.voucher.email}
						</span>
						<span class="ml-auto rounded-[5px] bg-base-300 px-2 py-0.5 text-[11px] font-semibold capitalize">
							{vouch.status}{vouch.counts ? ' · counts' : ''}
						</span>
					</div>
					{#if !vouch.voucher.inGoodStanding}
						<p class="mt-1 text-[12px] text-warning">Voucher is no longer approved or is banned — not counted.</p>
					{/if}
					<p class="mt-1 text-[12px] text-base-content-muted">Applicant says: "{vouch.relationship}"</p>
					{#if vouch.answers}
						<dl class="mt-2 grid grid-cols-[170px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
							<dt class="text-outline">How they know them</dt><dd>{vouch.answers.howKnow}</dd>
							<dt class="text-outline">Known for</dt><dd>{vouch.answers.howLong}</dd>
							<dt class="text-outline">Would trust with care</dt><dd>{answerLabel[vouch.answers.wouldTrust]}</dd>
							<dt class="text-outline">Concerns</dt>
							<dd class={vouch.answers.hasConcerns ? 'font-semibold text-error' : ''}>
								{vouch.answers.hasConcerns ? `Yes — ${vouch.answers.concernsDetail ?? ''}` : 'No'}
							</dd>
							<dt class="text-outline">Would hire / recommend</dt><dd>{answerLabel[vouch.answers.wouldHire]}</dd>
							{#if vouch.answers.anythingElse}
								<dt class="text-outline">Anything else</dt><dd>{vouch.answers.anythingElse}</dd>
							{/if}
						</dl>
						<p class="mt-2 text-[11px] text-outline">
							Attested {vouch.attestedAt ? formatDate(vouch.attestedAt) : '—'} · IP {vouch.submittedIp ?? 'unknown'}
						</p>
					{/if}
					{#if vouch.adminReason}
						<p class="mt-2 text-[12px] text-error"><b>Admin note:</b> {vouch.adminReason}</p>
					{/if}
					{#if vouch.status === 'pending' || vouch.status === 'accepted'}
						<div class="mt-2.5 flex gap-2">
							<button type="button" class="btn btn-outline btn-xs" onclick={() => (acting = { vouch, action: 'flag' })}>Flag</button>
							<button type="button" class="btn btn-outline btn-xs" onclick={() => (acting = { vouch, action: 'revoke' })}>Revoke</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<VouchActionDialog
	action={acting?.action ?? null}
	voucherName={acting?.vouch.voucher.name ?? ''}
	{busy}
	onconfirm={(reason) => void confirm(reason)}
	oncancel={() => (acting = null)}
/>
```

- [ ] **Step 4: `GeneralRemarksCard.svelte`**

```svelte
<script lang="ts">
	/** Admin-only free text on the approval request — typically notes from
	 * an off-app chat. Never shown to the applicant. */
	import { saveGeneralRemarks } from '$lib/api/admin-approvals';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		requestId: string;
		remarks: string | null;
		updatedAt: string | null;
		onchanged: () => Promise<void>;
	}

	let { requestId, remarks, updatedAt, onchanged }: Props = $props();

	let draft = $state('');
	let saving = $state(false);

	$effect(() => {
		draft = remarks ?? '';
	});

	const dirty = $derived(draft.trim() !== (remarks ?? '').trim());

	async function save() {
		if (!dirty || saving) return;
		saving = true;
		const result = await saveGeneralRemarks(requestId, draft);
		if (result.ok) {
			toast.success('Remarks saved.');
			await onchanged();
		} else {
			toast.error('Remarks could not be saved. Please try again.');
		}
		saving = false;
	}
</script>

<div class="rounded-lg border border-card-border bg-base-100 p-5">
	<label class="fieldset">
		<span class="mb-1 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">General remarks</span>
		<textarea
			class="textarea min-h-28 w-full"
			maxlength="5000"
			placeholder="Notes from the interview"
			bind:value={draft}
		></textarea>
	</label>
	<div class="mt-2 flex items-center justify-between gap-2">
		<span class="text-xs text-outline">
			{updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString()}` : 'Only admins see this.'}
		</span>
		<button type="button" class="btn btn-primary btn-sm" disabled={!dirty || saving} onclick={() => void save()}>
			{#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
			Save
		</button>
	</div>
</div>
```

- [ ] **Step 5: Wire the detail page**

In `apps/web/src/routes/admin/approval-requests/[id]/+page.svelte`:
- Import `VouchesCard` and `GeneralRemarksCard`.
- In the left column (`<div class="flex flex-col gap-3.5">`, ~line 331), after the Services card, add:

```svelte
				{#if detail.applicantRole === 'service-provider'}
					<VouchesCard vouches={detail.vouches} onchanged={load} />
				{/if}
				<GeneralRemarksCard
					requestId={detail.approvalRequest.id}
					remarks={detail.approvalRequest.generalRemarks}
					updatedAt={detail.approvalRequest.generalRemarksUpdatedAt}
					onchanged={load}
				/>
```

`load` already exists on this page; it's called by `onsaved={() => void load()}`.

- [ ] **Step 6: Queue filter row and badges**

In `apps/web/src/routes/admin/approval-requests/+page.svelte`:
- Add the type and state:

```ts
	type VouchFilter = 'all' | 'needs-chat' | 'vouched' | 'concerns';
	let vouchFilter = $state<VouchFilter>('all');

	const isHelper = (entry: ApprovalQueueEntry) => entry.applicant.role === 'service-provider';
	const needsChat = (entry: ApprovalQueueEntry) =>
		isHelper(entry) && entry.vouches.counting < 2 && !entry.hasGeneralRemarks;
	const matchesVouchFilter = (entry: ApprovalQueueEntry, key: VouchFilter) =>
		key === 'all' ||
		(key === 'needs-chat' && needsChat(entry)) ||
		(key === 'vouched' && isHelper(entry) && entry.vouches.counting >= 2) ||
		(key === 'concerns' && isHelper(entry) && entry.vouches.hasConcern);
```

- In `filtered`, add before `if (query)`:

```ts
			if (!matchesVouchFilter(entry, vouchFilter)) return false;
```

- Add the derived chips, counting within the active status filter:

```ts
	const vouchFilters = $derived.by((): Array<{ key: VouchFilter; label: string }> => {
		const pool = (queue?.requests ?? []).filter(
			(entry) =>
				(filter !== 'needs-action' || entry.status === 'submitted') &&
				(filter !== 'approved' || entry.status === 'approved') &&
				(filter !== 'rejected' || entry.status === 'rejected')
		);
		const count = (key: VouchFilter) => pool.filter((entry) => matchesVouchFilter(entry, key)).length;
		return [
			{ key: 'all', label: 'All' },
			{ key: 'needs-chat', label: `Needs a chat · ${count('needs-chat')}` },
			{ key: 'vouched', label: `Vouched · ${count('vouched')}` },
			{ key: 'concerns', label: `Concerns · ${count('concerns')}` }
		];
	});
```

- Below the existing chip row, add a third row. It's hidden when `roleFilter === 'family'`, and the button markup and classes are the same as the status chips:

```svelte
	{#if roleFilter !== 'family'}
		<div class="mb-4 -mt-2 flex flex-wrap items-center gap-1.5">
			<span class="mr-1 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">Vouches</span>
			{#each vouchFilters as entry (entry.key)}
				<button
					type="button"
					class="rounded-pill px-4 py-2 text-[12.5px]
						{vouchFilter === entry.key
						? 'bg-secondary font-semibold text-secondary-content'
						: 'border border-outline-variant bg-base-100 font-medium text-base-content-muted'}"
					onclick={() => (vouchFilter = entry.key)}
				>
					{entry.label}
				</button>
			{/each}
		</div>
	{/if}
```

Also add `$effect(() => { if (roleFilter === 'family') vouchFilter = 'all'; });`.

- In each row's markup, next to the role label, add the badge:

```svelte
							{#if isHelper(entry)}
								<span
									class="rounded-[5px] px-2 py-0.5 text-[11px] font-semibold
										{entry.vouches.counting >= 2 ? 'bg-success-content text-success' : 'bg-base-300 text-base-content-muted'}"
								>
									Vouches {entry.vouches.counting}/2
								</span>
								{#if entry.vouches.hasConcern}
									<span class="rounded-[5px] bg-error-content px-2 py-0.5 text-[11px] font-semibold text-error">
										Concern
									</span>
								{/if}
							{/if}
```

To find the right spot, look for where the row's `roleLabel(entry.applicant.role)` is rendered.

- [ ] **Step 7: Check**

Run: `cd apps/api && bun run build && cd ../web && bun run check && bun run lint`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web-admin): vouches card, general remarks and the vouch queue filter"
```

---

### Task 9: End-to-end verification on the running stack

**Files:** none changed unless a defect turns up. Any fix goes back through its task's test cycle.

- [ ] **Step 1: Bring up the stack from this worktree**

Run `docker compose up -d` from the worktree root. Then confirm the mounts with `docker inspect api --format '{{range .Mounts}}{{.Source}}{{end}}'`; they must point at this worktree. Next, `docker restart api`, since the api container misses host edits. Start the web preview from `.claude/launch.json`, adding a config for this worktree on a port listed in `TRUSTED_ORIGINS` if none exists.

- [ ] **Step 2: Seed three accounts**

Use the dev sign-in recipe from the poppynz-dev-environment memory: magic link from `docker logs api`. Create:
- `helper-applicant@test.dev` (service-provider, not approved)
- `vouch-family@test.dev` (family, approved via the admin queue)
- `vouch-helper@test.dev` (service-provider, approved)

- [ ] **Step 3: Walk the flow and check each rule**

1. As the applicant, open `/service-provider/verification`. The Vouches section shows "0 of 2 recommended". Request a vouch from `nobody@test.dev`: expect the vague `VOUCHER_UNAVAILABLE` message. Request from both approved accounts: both rows show Pending.
2. As `vouch-family`, open `/family/vouches`. A toast arrived. Submit the form without ticking the attestation: Submit stays disabled. Tick it and submit: the row shows Vouched.
3. As `vouch-helper`, decline. The applicant's page shows Completed and Declined, "1 of 2".
4. As the applicant, click Submit for review: the nudge dialog appears and "Submit anyway" submits.
5. As admin, open `/admin/approval-requests`. The helper row shows "Vouches 1/2". "Needs a chat · 1" filters to it. Open the detail page: the vouch card shows the answers and the IP. Type in General remarks (the placeholder reads `Notes from the interview`) and save. Back on the queue, the row has left "Needs a chat".
6. Flag the family vouch with a reason. As the applicant, the row reads "Not counted" and no reason appears anywhere. To check, read the network response for `GET /api/v1/vouches/mine` and confirm it contains no answers and no `adminReason`.
7. Reach-out gate: as `vouch-family`, call `POST /api/v1/conversations` with `recipientUserId` set to the unapproved applicant's id. Expect 404 `RECIPIENT_NOT_FOUND`.

- [ ] **Step 4: Full API suite and the final check**

Run: `cd apps/api && bunx vitest run && cd ../web && bun run check && bun run lint`
Expected: all green. Report any failure verbatim.

- [ ] **Step 5: Hand off**

Use superpowers:finishing-a-development-branch.
