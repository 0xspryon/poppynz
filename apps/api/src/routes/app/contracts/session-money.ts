/**
 * Session money for the cycle page (Tier 3 step 2, spec 2026-10-28 §10):
 *
 *   POST /contracts/:id/sessions/:sessionId/preview   what an action (or an
 *        answer) would do to the session's money, before confirming it
 *
 * and each session's money state on the cycle view (refund and transfer
 * status). The preview runs the policy function on the frozen split (or,
 * before the charge, the provisional one) — the same numbers the action
 * then applies. Only the contract's family and helper may preview, under
 * the same rules as the action itself (a refused action previews nothing).
 */
import {
  checkResponse,
  checkSessionAction,
  cycleSessionMoney,
  plannedResolution,
  previewSessionMoney,
  type MoneyPreview,
  type SessionMoneyView
} from '@repo/billing';
import { SessionMoneyRepo } from '@repo/db';
import { Effect, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { authenticate, requirePermissions, type UserAndSession } from '@/api/lib/effect-auth';
import { parseJsonBody, validateInput } from '@/api/lib/schema-validator';
import { validateContractId } from './contracts.validator';
import { loadSessionContext, mapSessionRepoError, SessionActionRefusedError } from './sessions';

export const sessionPreviewValidationError = {
  code: 'INVALID_SESSION_PREVIEW',
  message: 'Preview an action or an answer; reduced hours need the minutes worked.'
} as const;

export const sessionPreviewSchema = Schema.Struct({
  action: Schema.optional(
    Schema.Literal('cancel', 'propose_day_off', 'report_no_show', 'report_reduced_hours', 'dispute')
  ),
  response: Schema.optional(Schema.Literal('accept', 'contest', 'decline')),
  minutesWorked: Schema.optional(Schema.NullOr(Schema.Int.pipe(Schema.nonNegative())))
});
export type SessionPreviewInput = Schema.Schema.Type<typeof sessionPreviewSchema>;
const validatePreviewInput = validateInput(sessionPreviewSchema, sessionPreviewValidationError);

const refuse = (reason: SessionActionRefusedError['reason']) =>
  Effect.fail(new SessionActionRefusedError({ reason }));

/** What confirming `input` now would do to the session's money (null when
 * the session isn't charged or can't be priced). */
export const previewSessionActionProgram = (
  userAndSession: UserAndSession,
  contractId: string,
  sessionId: string,
  input: SessionPreviewInput,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const ctx = yield* loadSessionContext(userAndSession.user.id, contractId, sessionId);
    const facts = {
      session: ctx.session,
      zone: ctx.zone,
      now,
      policy: ctx.policy,
      side: ctx.side,
      active: ctx.active
    };
    const base = {
      reportedBySide: ctx.side,
      recordedAt: now,
      minutesWorked: null as number | null,
      decision: null,
      decisionMinutesWorked: null
    };
    let hypothetical: Parameters<typeof previewSessionMoney>[2];
    if (input.response) {
      const refusal = checkResponse(input.response, facts);
      if (refusal) return yield* refuse(refusal);
      const active = ctx.active!;
      hypothetical = {
        ...base,
        kind: active.kind,
        reportedBySide: active.reportedBySide,
        recordedAt: active.recordedAt,
        minutesWorked: active.minutesWorked,
        status:
          input.response === 'accept'
            ? 'confirmed'
            : input.response === 'contest'
              ? 'contested'
              : 'reversed'
      };
    } else if (input.action) {
      const refusal = checkSessionAction(input.action, facts);
      if (refusal) return yield* refuse(refusal);
      if (input.action === 'dispute' && ctx.active) {
        hypothetical = { ...ctx.active, status: 'contested' };
      } else {
        const planned = plannedResolution(
          input.action === 'dispute' ? 'dispute_new' : input.action,
          facts
        );
        hypothetical = {
          ...base,
          kind: planned.kind,
          // What it does once it takes effect: a report accepted (or
          // confirmed by silence), a day off agreed; a dispute is held.
          status: planned.status === 'contested' ? 'contested' : 'confirmed',
          minutesWorked:
            input.action === 'report_reduced_hours' ? (input.minutesWorked ?? null) : null
        };
      }
    } else {
      return yield* refuse('invalid_response');
    }
    const preview: MoneyPreview | null = yield* previewSessionMoney(
      contractId,
      sessionId,
      hypothetical
    ).pipe((errors) => mapSessionRepoError(errors));
    return { preview };
  });

export const previewSessionActionRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const contractId = yield* validateContractId(c.req.param('id'));
    const sessionId = yield* validateContractId(c.req.param('sessionId'));
    const body = yield* parseJsonBody(c, sessionPreviewValidationError);
    const input = yield* validatePreviewInput(body);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { sessionResolution: ['read'] })(
      authenticated
    );
    return yield* previewSessionActionProgram(userAndSession, contractId, sessionId, input, now);
  });

/** Each session's money on the cycle page, as the viewer's side sees it: the
 * family its refunds, the helper the transfer of its pay. */
export const cycleMoneyView = (
  contractId: string,
  sessionIds: ReadonlyArray<string>,
  side: 'family' | 'provider'
) =>
  cycleSessionMoney(contractId, sessionIds).pipe(
    Effect.map(
      (bySession) =>
        new Map(
          [...bySession].map(([sessionId, view]) => [
            sessionId,
            {
              mechanism: view.mechanism,
              refunds: side === 'family' ? view.refunds : [],
              transfer: side === 'provider' ? view.transfer : null
            } satisfies SessionMoneyView
          ])
        )
    )
  );

/** The helper's transfers of one cycle (first, then follow-ups). */
export const cycleTransfersView = (cycleId: string) =>
  SessionMoneyRepo.pipe(
    Effect.flatMap((repo) => repo.listTransfers({ cycleId })),
    Effect.map((rows) =>
      rows
        .sort((a, b) => a.sequence - b.sequence)
        .map((row) => ({
          id: row.id,
          sequence: row.sequence,
          status: row.status,
          amountCents: row.amountCents,
          recoveredCents: row.recoveredCents,
          dueAt: row.dueAt.toISOString(),
          sentAt: row.sentAt?.toISOString() ?? null
        }))
    )
  );
