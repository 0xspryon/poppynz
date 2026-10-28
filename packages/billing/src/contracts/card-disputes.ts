import {
  CardDisputeRepo,
  closedCardDisputeStatuses,
  ContractAgreementRepo,
  ContractBillingRepo,
  ContractRepo,
  PaymentRepo,
  SessionMoneyRepo,
  SessionResolutionRepo,
  type BillingLedgerInsert,
  type CardDispute,
  type CardDisputeAllocation,
  type CardDisputeSession,
  type CardDisputeSessionInsert,
  type CardDisputeTriage,
  type Contract,
  type ContractBilling,
  type Payment,
  UserProfileRepo,
  UserRepo
} from '@repo/db';
import { cardDisputeConfig } from '@repo/env';
import {
  DISPUTE_EVIDENCE_TOTAL_CHARS,
  disputeEvidenceTextLimits,
  Payments,
  type DisputeEvidenceFileField,
  type DisputeEvidenceTextField,
  type ProviderDispute
} from '@repo/payments';
import { Data, Effect, Either } from 'effect';
import { allocateLargestRemainder } from '../pricing';
import { sendCardDisputeNotice } from './card-dispute-notices';
import { ensureCycleSplit, resumeAfterAdminReview } from './engine';
import { renderTextPdf, type PdfSection } from './evidence-pdf';
import {
  CARD_DISPUTE_LOST_FLAG,
  CARD_DISPUTE_OPEN_FLAG,
  currentResolution,
  cyclePayables,
  ensureFollowUpTransfer,
  helperPaidSoFar
} from './money';
import { alertAdmins, cycleDates } from './notices';
import { sessionResolutionPolicy } from './resolutions';

/**
 * Card disputes (chargebacks) — Tier 3 step 4, spec 2026-10-28 §15, umbrella
 * §9 (founder rules).
 *
 *   - Every `charge.dispute.*` webhook re-fetches the dispute and brings its
 *     record in step (`syncCardDispute`): created once with the sessions its
 *     charge paid for and the disputed amount attributed across them (the
 *     §5 largest-remainder rule); the provider's debit, reinstatement and
 *     fee go to the ledger (Poppynz bears them); the payment's refund-
 *     blocking flag is set while it is open and cleared when it closes.
 *   - While open: refunds on the charge wait; unpaid helper pay for the
 *     disputed sessions is held (transfers for everything else continue);
 *     the admins are alerted, and reminded before the evidence is due.
 *   - The admin reviews an evidence pack assembled from the records, edits a
 *     summary and submits it through the provider (within its limits).
 *   - Future cycles are NOT suspended automatically: an admin may suspend the
 *     family's contracts (unreliable payment method / suspected fraud), with
 *     a reason, audited, and resume them.
 *   - Won: held pay is released. Lost: Poppynz bears the debit unless an
 *     admin decides, per session, that the helper didn't provide the service
 *     — then that pay is not paid, or recovered from the helper's future
 *     transfers (never by reversing a past transfer), with notice and audit.
 *     The family is never charged again automatically.
 */

export class CardDisputeError extends Data.TaggedError('CardDisputeError')<{
  reason:
    | 'not_found'
    | 'not_open'
    | 'already_submitted'
    | 'summary_required'
    | 'not_lost'
    | 'unknown_session'
    | 'already_allocated'
    | 'reason_required'
    | 'forfeit_too_high'
    | 'refused'
    | 'provider_unavailable'
    | 'nothing_to_suspend'
    | 'nothing_to_resume';
  detail?: string;
}> {}

const refuse = (reason: CardDisputeError['reason'], detail?: string) =>
  Effect.fail(new CardDisputeError({ reason, ...(detail ? { detail } : {}) }));

export const cardDisputePolicy = cardDisputeConfig.pipe(
  Effect.tapError((error) => Effect.logError('[billing] card dispute settings are invalid', error)),
  Effect.orDie
);

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)} CAD`;

export const isClosedDisputeStatus = (status: string) => closedCardDisputeStatuses.includes(status);

/** Outcomes the provider never moves away from (an inquiry's
 * `warning_closed` is left out: Stripe may still escalate it). */
const finalDisputeStatuses = ['won', 'lost', 'prevented'];

const evidenceSubmitted = (provider: Pick<ProviderDispute, 'status' | 'submissionCount'>) =>
  provider.submissionCount > 0 || provider.status.endsWith('under_review');

/** Poppynz's own handling state, from the provider's and the allocations. */
export const deriveTriage = (
  provider: Pick<ProviderDispute, 'status' | 'submissionCount'>,
  sessions: ReadonlyArray<Pick<CardDisputeSession, 'allocation'>>
): CardDisputeTriage => {
  if (!isClosedDisputeStatus(provider.status)) {
    return evidenceSubmitted(provider) ? 'evidence_submitted' : 'needs_response';
  }
  if (provider.status === 'lost' && sessions.some((row) => row.allocation === null)) {
    return 'allocation_needed';
  }
  return 'resolved';
};

// ---------------------------------------------------------------------------
// Which sessions are disputed

export type AttributableSession = {
  sessionId: string;
  familyTotalCents: number;
  startsAt: Date;
  slot: string;
};

/**
 * Divides a disputed amount across the sessions the charge paid for, in
 * proportion to what the family paid for each (largest remainder; ties to
 * the earlier session, by start then slot — the §5 rule). The sum is exact;
 * an amount above the sessions' total (a carried-in line is never a
 * session's) is attributed up to that total.
 */
export const attributeDisputedAmount = (
  amountCents: number,
  sessions: ReadonlyArray<AttributableSession>
): Array<{ sessionId: string; disputedCents: number }> => {
  const ordered = [...sessions].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0)
  );
  const total = ordered.reduce((t, row) => t + row.familyTotalCents, 0);
  const shares = allocateLargestRemainder(
    Math.max(0, Math.min(amountCents, total)),
    ordered.map((row) => row.familyTotalCents)
  );
  return ordered.map((row, index) => ({ sessionId: row.sessionId, disputedCents: shares[index]! }));
};

/** The record's scope and sessions for a payment: a cycle's charge (its
 * frozen split, made now if the cycle was captured without one), an extra
 * session's own payment (its split row), or any other payment. */
const disputeScope = (payment: Payment, amountCents: number) =>
  Effect.gen(function* () {
    const billingRepo = yield* ContractBillingRepo;
    const cycle = yield* billingRepo.findCycleByPaymentId(payment.id);
    let charges = yield* (yield* CardDisputeRepo).listChargesForPayment(payment.id);
    if (charges.length === 0 && cycle !== null) {
      // The split is the engine's to freeze (once, at capture).
      charges = (yield* ensureCycleSplit(cycle)).filter((row) => row.paymentId === payment.id);
    }
    const contractId = cycle?.contractId ?? charges[0]?.contractId ?? null;
    const cycleId = cycle?.id ?? charges[0]?.cycleId ?? null;
    const scope: CardDispute['scope'] =
      cycle !== null ? 'cycle' : charges.length > 0 ? 'extra_session' : 'payment';
    const sessions = contractId === null ? [] : yield* billingRepo.listSessions(contractId);
    const byId = new Map(sessions.map((row) => [row.id, row]));
    const attributable = charges.flatMap((charge) => {
      const session = byId.get(charge.sessionId);
      return session
        ? [
            {
              sessionId: charge.sessionId,
              familyTotalCents: charge.familyTotalCents,
              startsAt: session.startsAt,
              slot: session.slot
            }
          ]
        : [];
    });
    const shares = attributeDisputedAmount(amountCents, attributable);
    const rows: Array<CardDisputeSessionInsert> = shares.map((share) => {
      const charge = charges.find((row) => row.sessionId === share.sessionId)!;
      return {
        sessionId: share.sessionId,
        contractId: charge.contractId,
        cycleId: charge.cycleId,
        familyTotalCents: charge.familyTotalCents,
        helperShareCents: Math.max(0, charge.helperShareCents),
        disputedCents: share.disputedCents
      };
    });
    return { scope, contractId, cycleId, sessions: rows };
  });

// ---------------------------------------------------------------------------
// Webhooks: one sync for every lifecycle event

/** The ledger entries a dispute's balance transactions call for (Poppynz
 * bears the debit and the fee); keyed by the provider's transaction, so a
 * rerun writes nothing twice. */
export const disputeLedgerEntries = (
  dispute: Pick<CardDispute, 'id' | 'contractId' | 'cycleId' | 'paymentId' | 'providerReference'>,
  provider: Pick<ProviderDispute, 'balanceTransactions'>
): Array<BillingLedgerInsert> => {
  if (dispute.contractId === null) return [];
  const base = {
    contractId: dispute.contractId,
    cycleId: dispute.cycleId,
    paymentId: dispute.paymentId
  };
  return provider.balanceTransactions.flatMap(
    (transaction): Array<BillingLedgerInsert> => [
      {
        ...base,
        entryKey: `card_dispute:${dispute.id}:${transaction.reference}:amount`,
        kind: transaction.kind === 'withdrawal' ? 'dispute_withdrawn' : 'dispute_reinstated',
        party: 'platform',
        amountCents: transaction.amountCents,
        label: dispute.providerReference
      },
      ...(transaction.feeCents !== 0
        ? [
            {
              ...base,
              entryKey: `card_dispute:${dispute.id}:${transaction.reference}:fee`,
              kind: 'dispute_fee' as const,
              party: 'platform' as const,
              amountCents: transaction.feeCents,
              label: dispute.providerReference
            }
          ]
        : [])
    ]
  );
};

const sumOf = (provider: ProviderDispute, kind: 'withdrawal' | 'reinstatement') =>
  provider.balanceTransactions
    .filter((row) => row.kind === kind)
    .reduce((t, row) => t + row.amountCents, 0);

/** Keeps the payment's refund-blocking flag in step with its disputes:
 * set while one is open, `lost` once one was lost, cleared otherwise. */
const syncRefundFlag = (paymentId: string) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const payment = yield* paymentRepo
      .findById(paymentId)
      .pipe(Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)));
    if (payment === null) return;
    const disputes = yield* (yield* CardDisputeRepo).list({ paymentId });
    const flag = disputes.some((row) => row.closedAt === null)
      ? CARD_DISPUTE_OPEN_FLAG
      : disputes.some((row) => row.status === 'lost')
        ? CARD_DISPUTE_LOST_FLAG
        : null;
    const ours = [CARD_DISPUTE_OPEN_FLAG, CARD_DISPUTE_LOST_FLAG];
    if (flag !== null && payment.lastError !== flag) {
      yield* paymentRepo.update(payment.id, { lastError: flag });
    } else if (flag === null && payment.lastError !== null && ours.includes(payment.lastError)) {
      yield* paymentRepo.update(payment.id, { lastError: null });
    }
  });

/** The cycles a dispute's sessions belong to get a follow-up transfer when
 * their pay was released (won, or allocated): the cycle's first transfer
 * held it back. */
const releaseHeldPay = (disputeId: string, now: Date) =>
  Effect.gen(function* () {
    const sessions = yield* (yield* CardDisputeRepo).listSessions({ disputeIds: [disputeId] });
    const billingRepo = yield* ContractBillingRepo;
    const done = new Set<string>();
    for (const row of sessions) {
      if (done.has(row.cycleId)) continue;
      done.add(row.cycleId);
      const cycle = (yield* billingRepo.listCycles(row.contractId)).find(
        (candidate) => candidate.id === row.cycleId
      );
      if (cycle) yield* ensureFollowUpTransfer(cycle, now);
    }
  });

/**
 * Brings one dispute's record in step with the provider (any
 * `charge.dispute.*` event, in any order, any number of times): re-fetched,
 * created once, updated, its ledger and the payment's flag kept in step,
 * and the admins told once per step (opened, closed).
 */
export const syncCardDispute = (reference: string, now: Date) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* CardDisputeRepo;
    const provider = yield* payments.getDispute(reference);
    if (provider.paymentReference === null) return 'no payment intent on the dispute';
    const payment = yield* (yield* PaymentRepo).findByProviderReference(
      payments.provider,
      provider.paymentReference
    );
    if (payment === null) {
      yield* alertAdmins(`A card dispute on an unknown payment (${provider.reference})`, [
        `Stripe opened dispute ${provider.reference} (${dollars(provider.amountCents)}, ${provider.reason}) on ${provider.paymentReference}, which matches no Poppynz payment.`,
        'Check it in the Stripe dashboard.'
      ]);
      return 'unknown payment';
    }
    let row = yield* repo.findByProviderReference(payments.provider, provider.reference);
    if (row === null) {
      const scope = yield* disputeScope(payment, provider.amountCents);
      const ensured = yield* repo.ensure({
        dispute: {
          provider: payments.provider,
          providerReference: provider.reference,
          paymentId: payment.id,
          paymentReference: provider.paymentReference,
          chargeReference: provider.chargeReference,
          familyUserId: payment.userId,
          contractId: scope.contractId,
          cycleId: scope.cycleId,
          scope: scope.scope,
          amountCents: provider.amountCents,
          currency: provider.currency,
          reason: provider.reason,
          status: provider.status,
          providerCreatedAt: provider.createdAt,
          syncedAt: now
        },
        sessions: scope.sessions
      });
      row = ensured.dispute;
    }
    // A won or lost dispute is final at the provider. Two events handled at
    // once can re-fetch it in either order; an older read (still open) that
    // lands after the closing one must not reopen the record, put the refund
    // flag back or hold the pay again.
    if (finalDisputeStatuses.includes(row.status) && !isClosedDisputeStatus(provider.status)) {
      yield* Effect.logInfo(
        `[card-dispute] ${row.id}: ignored a stale re-fetch (${provider.status}) of a ${row.status} dispute`
      );
      return row.status;
    }
    const closed = isClosedDisputeStatus(provider.status);
    const sessions = yield* repo.listSessions({ disputeIds: [row.id] });
    const updated =
      (yield* repo.update(row.id, {
        status: provider.status,
        amountCents: provider.amountCents,
        reason: provider.reason,
        evidenceDueBy: provider.evidenceDueBy,
        chargeRefundable: provider.chargeRefundable,
        hasEvidence: provider.hasEvidence,
        evidenceSubmissionCount: provider.submissionCount,
        withdrawnCents: sumOf(provider, 'withdrawal'),
        reinstatedCents: sumOf(provider, 'reinstatement'),
        feeCents: provider.balanceTransactions.reduce((t, tx) => t + tx.feeCents, 0),
        triage: deriveTriage(provider, sessions),
        closedAt: closed ? (row.closedAt ?? now) : null,
        syncedAt: now
      })) ?? row;
    const ledger = disputeLedgerEntries(updated, provider);
    if (ledger.length > 0) yield* (yield* ContractBillingRepo).appendLedger(ledger);
    yield* syncRefundFlag(payment.id);

    if ((yield* repo.appendNotice(updated.id, 'opened')) !== null) {
      // An inquiry (`warning_*`) only asks for information: no money moved.
      const inquiry = updated.status.startsWith('warning_');
      const what =
        updated.scope === 'payment' ? 'not a contract charge' : `contract ${updated.contractId}`;
      yield* alertAdmins(
        `Card dispute ${inquiry ? 'inquiry ' : ''}opened: ${dollars(updated.amountCents)} (${updated.reason})`,
        [
          inquiry
            ? `The family's bank asks about ${dollars(updated.amountCents)} on payment ${payment.id} (${what}). This is an inquiry: no money has been taken yet, but an unanswered one can become a dispute.`
            : `The family's bank disputes ${dollars(updated.amountCents)} on payment ${payment.id} (${what}). Stripe has taken it from Poppynz's balance${updated.feeCents > 0 ? ` with a ${dollars(updated.feeCents)} fee` : ''}.`,
          updated.evidenceDueBy
            ? `Evidence is due by ${updated.evidenceDueBy.toISOString()}. Review the evidence pack and submit it from Admin › Card disputes.`
            : 'Review it in Admin › Card disputes.',
          `${sessions.length} session(s) are on the disputed charge: their unpaid helper pay is held and refunds on the charge wait until it closes.`
        ]
      );
    }
    if (
      row.status.startsWith('warning_') &&
      !updated.status.startsWith('warning_') &&
      (yield* repo.appendNotice(updated.id, 'escalated')) !== null
    ) {
      yield* alertAdmins(
        `Card inquiry escalated to a dispute: ${dollars(updated.amountCents)} (${updated.providerReference})`,
        [
          `The family's bank turned its inquiry on payment ${payment.id} into a dispute (${updated.reason}).${updated.withdrawnCents > 0 ? ` Stripe has taken ${dollars(updated.withdrawnCents)} from Poppynz's balance${updated.feeCents > 0 ? ` with a ${dollars(updated.feeCents)} fee` : ''}.` : ''}`,
          updated.evidenceDueBy
            ? `Evidence is due by ${updated.evidenceDueBy.toISOString()}. Review and submit it in Admin › Card disputes.`
            : 'Review it in Admin › Card disputes.'
        ]
      );
    }
    if (closed && (yield* repo.appendNotice(updated.id, `closed:${provider.status}`)) !== null) {
      if (provider.status !== 'lost') yield* releaseHeldPay(updated.id, now);
      yield* alertAdmins(
        `Card dispute ${provider.status}: ${dollars(updated.amountCents)} (${updated.providerReference})`,
        provider.status === 'lost'
          ? [
              `The issuer decided for the family: Poppynz bears the ${dollars(updated.amountCents)} debit and the fee. The family is never charged again automatically.`,
              sessions.length > 0
                ? 'Record, for each disputed session, whether Poppynz absorbs it or the helper did not provide the service (recovered from their future payouts) in Admin › Card disputes. Their pay stays held until then.'
                : 'No sessions are on this charge: nothing else to decide.'
            ]
          : [
              provider.status === 'won'
                ? `The issuer decided for Poppynz: ${dollars(updated.reinstatedCents)} is back in the balance (the fee is not returned). Held helper pay is released.`
                : 'The dispute closed without a debit. Held helper pay is released.'
            ]
      );
    }
    return updated.status;
  });

// ---------------------------------------------------------------------------
// The evidence pack

/** A party's full name and email for the evidence (the bank reads it; the
 * parties' own mails use the short display name). */
const fullNameOf = (userId: string) =>
  Effect.gen(function* () {
    const user = yield* (yield* UserRepo).findById(userId).pipe(Effect.orElseSucceed(() => null));
    const profile = yield* (yield* UserProfileRepo)
      .findByUserId(userId)
      .pipe(Effect.orElseSucceed(() => null));
    const named = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
    return { name: named || user?.name || 'Poppynz member', email: user?.email ?? null };
  });

const fmtDate = (date: Date | null) => (date ? date.toISOString().replace('.000Z', 'Z') : '—');
const minutes = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

export type EvidencePack = Effect.Effect.Success<ReturnType<typeof assembleEvidencePack>>;

/** Everything Poppynz knows about a disputed charge, from its records. */
export const assembleEvidencePack = (disputeId: string) =>
  Effect.gen(function* () {
    const repo = yield* CardDisputeRepo;
    const dispute = yield* repo.findById(disputeId);
    if (dispute === null) return yield* refuse('not_found');
    const { evidenceMessageDays, evidenceMaxMessages } = yield* cardDisputePolicy;
    const { cancellationNoticeHours } = yield* sessionResolutionPolicy;
    const payment = yield* (yield* PaymentRepo)
      .findById(dispute.paymentId)
      .pipe(Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)));
    const disputeSessions = yield* repo.listSessions({ disputeIds: [dispute.id] });
    const family = yield* fullNameOf(dispute.familyUserId);
    const contract: Contract | null =
      dispute.contractId === null
        ? null
        : yield* (yield* ContractRepo).findById(dispute.contractId);
    const helper = contract ? yield* fullNameOf(contract.providerUserId) : null;
    const billingRepo = yield* ContractBillingRepo;
    const billing: ContractBilling | null = contract
      ? yield* billingRepo.findBilling(contract.id)
      : null;
    const allSessions = contract ? yield* billingRepo.listSessions(contract.id) : [];
    const cycles = contract ? yield* billingRepo.listCycles(contract.id) : [];
    const cycle = cycles.find((row) => row.id === dispute.cycleId) ?? null;
    const resolutionRepo = yield* SessionResolutionRepo;
    const resolutions = contract ? yield* resolutionRepo.listForContract(contract.id) : [];
    const signatures = contract
      ? (yield* (yield* ContractAgreementRepo).listForContract(contract.id)).filter(
          (row) =>
            row.voidedAt === null &&
            (billing === null || row.contractVersionId === billing.acceptedVersionId)
        )
      : [];
    const authorisations = yield* repo.listExtraSessionAuthorisations(
      disputeSessions.map((row) => row.sessionId)
    );
    const sessions = yield* Effect.forEach(
      [...disputeSessions].sort((a, b) => {
        const left = allSessions.find((row) => row.id === a.sessionId);
        const right = allSessions.find((row) => row.id === b.sessionId);
        return (left?.startsAt.getTime() ?? 0) - (right?.startsAt.getTime() ?? 0);
      }),
      (row) =>
        Effect.gen(function* () {
          const session = allSessions.find((candidate) => candidate.id === row.sessionId) ?? null;
          const resolution = currentResolution(resolutions, row.sessionId);
          const events = resolution ? yield* resolutionRepo.listEvents(resolution.id) : [];
          const authorisation =
            authorisations.find((candidate) => candidate.sessionId === row.sessionId) ?? null;
          return {
            sessionId: row.sessionId,
            date: session?.date ?? null,
            serviceName: session?.serviceName ?? null,
            startMinutes: session?.startMinutes ?? null,
            endMinutes: session?.endMinutes ?? null,
            startsAt: session?.startsAt ?? null,
            endsAt: session?.endsAt ?? null,
            status: session?.status ?? null,
            familyTotalCents: row.familyTotalCents,
            helperShareCents: row.helperShareCents,
            disputedCents: row.disputedCents,
            allocation: row.allocation,
            allocationReason: row.allocationReason,
            helperForfeitCents: row.helperForfeitCents,
            recoveryId: row.recoveryId,
            allocatedAt: row.allocatedAt,
            resolution: resolution
              ? {
                  kind: resolution.kind,
                  status: resolution.status,
                  reportedBySide: resolution.reportedBySide,
                  recordedAt: resolution.recordedAt,
                  note: resolution.note,
                  response: resolution.response,
                  respondedAt: resolution.respondedAt,
                  decision: resolution.decision,
                  decisionReason: resolution.decisionReason,
                  decidedAt: resolution.decidedAt,
                  policyVersion: resolution.policyVersion,
                  events: events.map((event) => ({
                    action: event.action,
                    actorSide: event.actorSide,
                    fromStatus: event.fromStatus,
                    toStatus: event.toStatus,
                    note: event.note,
                    at: event.createdAt
                  }))
                }
              : null,
            extraAuthorisation: authorisation
              ? {
                  authorisedAt: authorisation.authorisedAt,
                  authorisedCents: authorisation.authorisedCents
                }
              : null
          };
        })
    );
    const firstStart = sessions
      .map((row) => row.startsAt)
      .filter((value): value is Date => value !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const lastEnd = sessions
      .map((row) => row.endsAt)
      .filter((value): value is Date => value !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const from = new Date(
      (firstStart ?? dispute.providerCreatedAt).getTime() - evidenceMessageDays * 86_400_000
    );
    // Up to the dispute — or a day after the last session, when the bank
    // disputed it before then.
    const to = new Date(
      Math.max(dispute.providerCreatedAt.getTime(), (lastEnd?.getTime() ?? 0) + 86_400_000)
    );
    const messages = contract
      ? (yield* resolutionRepo.listMessagesBetween(contract.conversationId, from, to)).slice(
          -evidenceMaxMessages
        )
      : [];
    const refunds = yield* (yield* SessionMoneyRepo).listRefunds({
      paymentIds: [dispute.paymentId]
    });
    const submissions = yield* repo.listSubmissions(dispute.id);
    const side = (userId: string) =>
      contract === null
        ? 'other'
        : userId === contract.familyUserId
          ? 'family'
          : userId === contract.providerUserId
            ? 'helper'
            : 'other';
    return {
      dispute,
      /** The free-cancellation notice the policy applies (the evidence
       * quotes it; CONTRACT_CANCELLATION_NOTICE_HOURS). */
      cancellationNoticeHours,
      family: { userId: dispute.familyUserId, name: family.name, email: family.email },
      helper: helper && contract ? { userId: contract.providerUserId, name: helper.name } : null,
      contract: contract
        ? {
            id: contract.id,
            timeZone: billing?.timeZone ?? null,
            startsOn: billing?.startsOn ?? null
          }
        : null,
      payment: payment
        ? {
            id: payment.id,
            kind: payment.kind,
            status: payment.status,
            description: payment.description,
            totalCents: payment.totalCents,
            capturedCents: payment.capturedCents,
            createdAt: payment.createdAt,
            authorisedAt: payment.authorisedAt,
            capturedAt: payment.capturedAt,
            refundedAt: payment.refundedAt,
            providerReference: payment.providerReference,
            receiptUrl: payment.receiptUrl
          }
        : null,
      cycle: cycle
        ? {
            id: cycle.id,
            index: cycle.index,
            startsOn: cycle.startsOn,
            endsOn: cycle.endsOn,
            holdAt: cycle.holdAt,
            captureAt: cycle.captureAt,
            heldCents: cycle.heldCents,
            capturedCents: cycle.capturedCents,
            fundedAt: cycle.fundedAt,
            capturedAt: cycle.capturedAt
          }
        : null,
      agreement: signatures.map((signature) => ({
        side: signature.signerSide,
        signerName: signature.signerSide === 'family' ? family.name : (helper?.name ?? null),
        signedAt: signature.signedAt,
        contractVersion: signature.contractVersion,
        templateVersion: signature.templateVersion,
        locale: signature.locale,
        sha256: signature.contentSha256,
        cancellationPolicyVersion: signature.cancellationPolicyVersion,
        content: signature.content
      })),
      sessions,
      messages: messages.map((message) => ({
        side: side(message.senderUserId),
        body: message.body,
        sentAt: message.createdAt
      })),
      refunds: refunds.map((refund) => ({
        id: refund.id,
        sessionId: refund.sessionId,
        totalCents: refund.totalCents,
        status: refund.status,
        refundedAt: refund.refundedAt,
        createdAt: refund.createdAt
      })),
      submissions
    };
  });

/** The admin's starting point for the summary (English: the issuer reads it). */
export const defaultEvidenceSummary = (pack: EvidencePack) => {
  const family = pack.family.name;
  const helper = pack.helper?.name ?? 'the helper';
  const signed = pack.agreement.find((row) => row.side === 'family');
  const completed = pack.sessions.filter((row) => row.status === 'completed').length;
  const reported = pack.sessions.filter((row) => row.resolution !== null);
  const refunded = pack.refunds.filter((row) => row.status === 'succeeded');
  return [
    `${family} booked care with ${helper} through Poppynz, a Canadian platform connecting families with care helpers.`,
    signed
      ? `${family} signed the written service agreement on ${fmtDate(signed.signedAt)} (SHA-256 ${signed.sha256}), which sets out the schedule, the rates, the cancellation policy and that each cycle of sessions is charged to the card on file.`
      : 'The family accepted the contract terms in the app before any charge.',
    pack.sessions.length > 0
      ? `The disputed charge of ${dollars(pack.dispute.amountCents)} paid for ${pack.sessions.length} session(s); ${completed} took place as scheduled${reported.length === 0 ? ' and the family reported no problem with any of them in the app' : ''}.`
      : `The disputed charge of ${dollars(pack.dispute.amountCents)} was for a service ordered in the app.`,
    ...reported.map(
      (row) =>
        `${row.date} ${row.serviceName}: ${row.resolution!.kind.replaceAll('_', ' ')} (${row.resolution!.status}${row.resolution!.decision ? `, decided ${row.resolution!.decision.replaceAll('_', ' ')}` : ''}).`
    ),
    refunded.length > 0
      ? `Refunds already made on this charge: ${refunded.map((row) => dollars(row.totalCents)).join(', ')}.`
      : 'No refund was requested for these sessions.',
    'The attached documents contain the signed agreement, the session timetable with every report and its audit trail, the charge and authorisation records, and the messages exchanged in the app.'
  ].join('\n\n');
};

/** The provider's text fields and documents for a pack and a summary. */
export const buildEvidence = (pack: EvidencePack, summary: string) => {
  const sessionLines = pack.sessions.map(
    (row) =>
      `${row.date ?? '—'} ${row.startMinutes !== null ? minutes(row.startMinutes) : ''}–${row.endMinutes !== null ? minutes(row.endMinutes) : ''} ${row.serviceName ?? ''} — ${row.status ?? 'unknown'} — paid ${dollars(row.familyTotalCents)}, disputed ${dollars(row.disputedCents)}`
  );
  const dates = pack.sessions
    .map((row) => row.date)
    .filter((value): value is string => value !== null)
    .sort();
  const signed = pack.agreement.find((row) => row.side === 'family');
  const authorisation = [
    ...pack.agreement.map(
      (row) =>
        `Service agreement signed by the ${row.side} (${row.signerName ?? '—'}) at ${fmtDate(row.signedAt)} — template v${row.templateVersion}, contract v${row.contractVersion}, SHA-256 ${row.sha256}.`
    ),
    ...(pack.payment
      ? [
          `Payment ${pack.payment.providerReference ?? pack.payment.id}: created ${fmtDate(pack.payment.createdAt)}, card hold authorised ${fmtDate(pack.payment.authorisedAt)}, captured ${fmtDate(pack.payment.capturedAt)} (${dollars(pack.payment.capturedCents ?? pack.payment.totalCents)}).`
        ]
      : []),
    ...pack.sessions
      .filter((row) => row.extraAuthorisation !== null)
      .map(
        (row) =>
          `Extra session ${row.date}: the family ticked "I authorise this charge" at ${fmtDate(row.extraAuthorisation!.authorisedAt)} for ${dollars(row.extraAuthorisation!.authorisedCents ?? 0)}.`
      )
  ];
  const refunds =
    pack.refunds.length === 0
      ? ['No refund was requested or made on this charge.']
      : pack.refunds.map(
          (row) =>
            `Refund ${dollars(row.totalCents)} for the session ${pack.sessions.find((s) => s.sessionId === row.sessionId)?.date ?? row.sessionId}: ${row.status}${row.refundedAt ? ` on ${fmtDate(row.refundedAt)}` : ''}.`
        );
  const text: Partial<Record<DisputeEvidenceTextField, string>> = {
    uncategorized_text: summary,
    product_description: [
      `In-home care booked through Poppynz${pack.helper ? ` with ${pack.helper.name}` : ''}.`,
      ...(pack.dispute.scope === 'extra_session'
        ? [
            `Charge for an extra session the family confirmed and authorised in the app (charged ${fmtDate(pack.payment?.capturedAt ?? null)}).`
          ]
        : pack.cycle
          ? [
              `Charge for the cycle ${cycleDates(pack.cycle)} (charged ${fmtDate(pack.cycle.capturedAt)}).`
            ]
          : []),
      ...sessionLines
    ].join('\n'),
    customer_name: pack.family.name,
    ...(pack.family.email ? { customer_email_address: pack.family.email } : {}),
    ...(dates.length > 0
      ? { service_date: dates.length === 1 ? dates[0]! : `${dates[0]} to ${dates.at(-1)}` }
      : {}),
    ...(signed
      ? {
          cancellation_policy_disclosure: `The cancellation policy is part of the service agreement the family signed in the app on ${fmtDate(signed.signedAt)} (Terms of Service version ${signed.cancellationPolicyVersion ?? '—'}; agreement SHA-256 ${signed.sha256}). Cancelling at least ${pack.cancellationNoticeHours} hours before a session is free; the full text is in the service documentation.`
        }
      : {}),
    refund_policy_disclosure: refunds.join('\n'),
    access_activity_log: authorisation.join('\n')
  };
  const documentation: Array<PdfSection> = [
    {
      heading: 'Dispute',
      lines: [
        `Provider dispute ${pack.dispute.providerReference}: ${dollars(pack.dispute.amountCents)}, reason ${pack.dispute.reason}, opened ${fmtDate(pack.dispute.providerCreatedAt)}.`,
        `Family: ${pack.family.name}${pack.family.email ? ` <${pack.family.email}>` : ''}. Helper: ${pack.helper?.name ?? '—'}.`
      ]
    },
    { heading: 'Summary', lines: summary.split('\n') },
    { heading: 'Charge and authorisation records', lines: authorisation },
    {
      heading: 'Sessions paid by this charge',
      lines: pack.sessions.flatMap((row, index) => [
        sessionLines[index]!,
        ...(row.resolution
          ? [
              `  Report: ${row.resolution.kind} by the ${row.resolution.reportedBySide} at ${fmtDate(row.resolution.recordedAt)} — ${row.resolution.status}${row.resolution.decision ? `, decided ${row.resolution.decision} (${row.resolution.decisionReason ?? ''})` : ''}. Policy v${row.resolution.policyVersion ?? '—'}.`,
              ...row.resolution.events.map(
                (event) =>
                  `    ${fmtDate(event.at)} ${event.actorSide}: ${event.action} ${event.fromStatus ?? '—'} → ${event.toStatus}${event.note ? ` — ${event.note}` : ''}`
              )
            ]
          : ['  No report, cancellation or dispute was recorded for this session.'])
      ])
    },
    { heading: 'Refunds', lines: refunds },
    // Both parties sign the same text: quote each distinct text once, naming
    // who signed it.
    ...[...new Set(pack.agreement.map((row) => row.sha256))].map((sha256) => {
      const signed = pack.agreement.filter((row) => row.sha256 === sha256);
      return {
        heading: `Signed service agreement — ${signed.map((row) => `${row.side} ${fmtDate(row.signedAt)}`).join(', ')} (SHA-256 ${sha256})`,
        lines: signed[0]!.content.split('\n')
      };
    })
  ];
  const communication: Array<PdfSection> =
    pack.messages.length === 0
      ? []
      : [
          {
            heading: 'Messages exchanged in the app (excerpt)',
            lines: pack.messages.map(
              (message) =>
                `[${fmtDate(message.sentAt)}] ${message.side === 'family' ? pack.family.name : message.side === 'helper' ? (pack.helper?.name ?? 'Helper') : 'Poppynz'}: ${message.body}`
            )
          }
        ];
  return { text: fitEvidenceText(text), documentation, communication };
};

const ellipsis = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;

/** Each field within its limit, and all of them within the total: the
 * least important fields are shortened first, the admin's summary last. */
export const fitEvidenceText = (
  text: Partial<Record<DisputeEvidenceTextField, string>>
): Partial<Record<DisputeEvidenceTextField, string>> => {
  const out: Partial<Record<DisputeEvidenceTextField, string>> = {};
  for (const [field, value] of Object.entries(text) as Array<[DisputeEvidenceTextField, string]>) {
    out[field] = ellipsis(value, disputeEvidenceTextLimits[field]);
  }
  const order: Array<DisputeEvidenceTextField> = [
    'access_activity_log',
    'refund_policy_disclosure',
    'cancellation_policy_disclosure',
    'product_description',
    'uncategorized_text'
  ];
  const total = () => Object.values(out).reduce((t, value) => t + (value?.length ?? 0), 0);
  for (const field of order) {
    const over = total() - DISPUTE_EVIDENCE_TOTAL_CHARS;
    if (over <= 0) break;
    const value = out[field];
    if (value) out[field] = ellipsis(value, Math.max(0, value.length - over));
  }
  return out;
};

// ---------------------------------------------------------------------------
// Admin actions

const snapshot = (row: unknown) => JSON.parse(JSON.stringify(row)) as Record<string, unknown>;

/** Saves the admin's summary draft (audited). */
export const saveEvidenceSummary = (
  disputeId: string,
  summary: string,
  actorUserId: string,
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* CardDisputeRepo;
    const dispute = yield* repo.findById(disputeId);
    if (dispute === null) return yield* refuse('not_found');
    if (dispute.triage !== 'needs_response') return yield* refuse('not_open');
    const saved = (yield* repo.update(disputeId, {
      evidenceSummary: summary,
      evidenceSummaryByUserId: actorUserId,
      evidenceSummaryAt: now
    }))!;
    yield* (yield* SessionMoneyRepo).appendAudit({
      entity: 'card_dispute',
      entityId: disputeId,
      action: 'evidence_summary_saved',
      actorUserId,
      note: null,
      before: { evidenceSummary: dispute.evidenceSummary },
      after: { evidenceSummary: summary }
    });
    return saved;
  });

/** Submits the evidence to the provider (final): the summary and the text
 * fields, with the pack as PDF documents; records what was sent. */
export const submitCardDisputeEvidence = (
  disputeId: string,
  summary: string,
  actorUserId: string,
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* CardDisputeRepo;
    const payments = yield* Payments;
    const dispute = yield* repo.findById(disputeId);
    if (dispute === null) return yield* refuse('not_found');
    if (dispute.closedAt !== null) return yield* refuse('not_open');
    if (dispute.triage !== 'needs_response' || dispute.evidenceSubmissionCount > 0) {
      return yield* refuse('already_submitted');
    }
    if (summary.trim() === '') return yield* refuse('summary_required');
    const pack = yield* assembleEvidencePack(disputeId);
    const evidence = buildEvidence(pack, summary.trim());
    const uploads: Array<{ field: DisputeEvidenceFileField; name: string; bytes: Uint8Array }> = [
      {
        field: 'service_documentation',
        name: `poppynz-evidence-${dispute.providerReference}.pdf`,
        bytes: renderTextPdf('Poppynz — service documentation', evidence.documentation)
      },
      ...(evidence.communication.length > 0
        ? [
            {
              field: 'customer_communication' as const,
              name: `poppynz-messages-${dispute.providerReference}.pdf`,
              bytes: renderTextPdf('Poppynz — messages', evidence.communication)
            }
          ]
        : [])
    ];
    const files: Array<{ field: string; reference: string; name: string; bytes: number }> = [];
    for (const upload of uploads) {
      const uploaded = yield* payments
        .uploadDisputeFile({ name: upload.name, bytes: upload.bytes })
        .pipe(Effect.either);
      if (Either.isLeft(uploaded)) {
        yield* Effect.logWarning(`[card-dispute] evidence upload failed`, uploaded.left);
        return yield* refuse('provider_unavailable');
      }
      files.push({
        field: upload.field,
        reference: uploaded.right.reference,
        name: upload.name,
        bytes: upload.bytes.byteLength
      });
    }
    const sent = yield* payments
      .updateDisputeEvidence({
        reference: dispute.providerReference,
        text: evidence.text,
        files: Object.fromEntries(files.map((file) => [file.field, file.reference])),
        submit: true,
        metadata: { card_dispute_id: dispute.id }
      })
      .pipe(Effect.either);
    if (Either.isLeft(sent)) {
      if (sent.left.refusal !== undefined) return yield* refuse('refused', sent.left.refusal);
      yield* Effect.logWarning(`[card-dispute] evidence not sent`, sent.left);
      return yield* refuse('provider_unavailable');
    }
    const provider = sent.right;
    const sessions = yield* repo.listSessions({ disputeIds: [dispute.id] });
    const submission = yield* repo.recordSubmission(
      {
        disputeId: dispute.id,
        submittedByUserId: actorUserId,
        submittedAt: now,
        summary: summary.trim(),
        fields: evidence.text as Record<string, string>,
        files,
        providerStatus: provider.status
      },
      {
        status: provider.status,
        hasEvidence: provider.hasEvidence,
        evidenceSubmissionCount: provider.submissionCount,
        evidenceSummary: summary.trim(),
        evidenceSummaryByUserId: actorUserId,
        evidenceSummaryAt: now,
        triage: deriveTriage(
          { status: provider.status, submissionCount: Math.max(1, provider.submissionCount) },
          sessions
        ),
        syncedAt: now
      },
      {
        entity: 'card_dispute',
        entityId: dispute.id,
        action: 'evidence_submitted',
        actorUserId,
        note: null,
        before: snapshot({ status: dispute.status, triage: dispute.triage })
      }
    );
    return submission;
  });

export type AllocationInput = {
  sessionId: string;
  allocation: CardDisputeAllocation;
  reason: string | null;
  /** helper_not_provided: what the helper bears (default: the helper's share
   * of the disputed part of the session). */
  helperForfeitCents?: number | null;
};

/** The helper's share of a session's disputed part (half up). */
export const defaultHelperForfeit = (
  row: Pick<CardDisputeSession, 'helperShareCents' | 'familyTotalCents' | 'disputedCents'>
) =>
  row.familyTotalCents === 0
    ? 0
    : Math.min(
        row.helperShareCents,
        Math.floor(
          (row.helperShareCents * row.disputedCents * 2 + row.familyTotalCents) /
            (2 * row.familyTotalCents)
        )
      );

/** Records the admin's decision for sessions of a lost dispute, each once:
 * Poppynz absorbs it, or the helper didn't provide the service — their pay
 * for it is not paid, or recovered from their next transfers (never a
 * reversal), with notice and audit. */
export const allocateLostCardDispute = (
  disputeId: string,
  items: ReadonlyArray<AllocationInput>,
  actorUserId: string,
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* CardDisputeRepo;
    const dispute = yield* repo.findById(disputeId);
    if (dispute === null) return yield* refuse('not_found');
    if (dispute.status !== 'lost') return yield* refuse('not_lost');
    const sessions = yield* repo.listSessions({ disputeIds: [disputeId] });
    // Validate everything before writing anything.
    for (const item of items) {
      const row = sessions.find((candidate) => candidate.sessionId === item.sessionId);
      if (!row) return yield* refuse('unknown_session');
      if (row.allocation !== null) return yield* refuse('already_allocated');
      if (item.allocation === 'helper_not_provided') {
        if (!item.reason || item.reason.trim() === '') return yield* refuse('reason_required');
        if (
          item.helperForfeitCents !== undefined &&
          item.helperForfeitCents !== null &&
          (item.helperForfeitCents < 0 || item.helperForfeitCents > row.helperShareCents)
        ) {
          return yield* refuse('forfeit_too_high');
        }
      }
    }
    const contract =
      dispute.contractId === null
        ? null
        : yield* (yield* ContractRepo).findById(dispute.contractId);
    const billingRepo = yield* ContractBillingRepo;
    const allocated: Array<CardDisputeSession> = [];
    for (const item of items) {
      const row = sessions.find((candidate) => candidate.sessionId === item.sessionId)!;
      const base = {
        contractId: row.contractId,
        cycleId: row.cycleId,
        sessionId: row.sessionId,
        paymentId: dispute.paymentId
      };
      const audit = {
        entity: 'card_dispute',
        entityId: disputeId,
        action: `session_${item.allocation}`,
        actorUserId,
        note: item.reason?.trim() || null,
        before: snapshot(row)
      };
      if (item.allocation === 'poppynz_absorbs') {
        const done = yield* repo.allocateSession({
          disputeId,
          sessionId: row.sessionId,
          allocation: 'poppynz_absorbs',
          reason: item.reason?.trim() || 'Poppynz absorbs the lost dispute',
          helperForfeitCents: 0,
          actorUserId,
          at: now,
          recovery: null,
          ledger: [
            {
              ...base,
              entryKey: `card_dispute:${disputeId}:${row.sessionId}:absorbed`,
              kind: 'platform_absorbed',
              party: 'platform',
              amountCents: row.disputedCents,
              label: 'card dispute lost: Poppynz absorbs'
            }
          ],
          audit
        });
        if (done === null) return yield* refuse('already_allocated');
        allocated.push(done);
        continue;
      }
      // The helper didn't provide the service: what they bear, what was
      // already paid for the session (net of recoveries) and what they are
      // owed for it now decide what is withheld and what is recovered.
      const cycle = (yield* billingRepo.listCycles(row.contractId)).find(
        (candidate) => candidate.id === row.cycleId
      );
      const owed =
        (cycle ? yield* cyclePayables(cycle) : []).find(
          (payable) => payable.sessionId === row.sessionId
        )?.money.helperOwed.totalCents ?? row.helperShareCents;
      // Never more than the helper is owed for the session: a session whose
      // pay a refund or cancellation already reduced can't cost them its
      // full share (the ledger and the helper's email say what they bear).
      const forfeit = Math.max(
        0,
        Math.min(item.helperForfeitCents ?? defaultHelperForfeit(row), owed)
      );
      const paid = (yield* helperPaidSoFar(row.sessionId)).paid;
      const recoverCents = Math.max(0, paid - Math.max(0, owed - forfeit));
      const helperUserId = contract?.providerUserId ?? null;
      const done = yield* repo.allocateSession({
        disputeId,
        sessionId: row.sessionId,
        allocation: 'helper_not_provided',
        reason: item.reason!.trim(),
        helperForfeitCents: forfeit,
        actorUserId,
        at: now,
        recovery:
          recoverCents > 0 && helperUserId !== null
            ? {
                recoveryKey: `card_dispute:${disputeId}:${row.sessionId}`,
                helperUserId,
                contractId: row.contractId,
                sessionId: row.sessionId,
                resolutionId: null,
                cardDisputeId: disputeId,
                amountCents: recoverCents
              }
            : null,
        ledger:
          forfeit > 0
            ? [
                {
                  ...base,
                  entryKey: `card_dispute:${disputeId}:${row.sessionId}:helper`,
                  kind: 'helper_recovery',
                  party: 'provider',
                  amountCents: forfeit,
                  label:
                    recoverCents > 0
                      ? `card dispute lost: helper did not provide the service (${recoverCents} recovered from future transfers)`
                      : 'card dispute lost: helper did not provide the service (not paid)'
                }
              ]
            : [],
        audit
      });
      if (done === null) return yield* refuse('already_allocated');
      allocated.push(done);
      if (contract && forfeit > 0) {
        const session = (yield* billingRepo.listSessions(row.contractId, row.cycleId)).find(
          (candidate) => candidate.id === row.sessionId
        );
        yield* sendCardDisputeNotice('helper_recovery', ['helper'], {
          contract,
          session: session ? { date: session.date, serviceName: session.serviceName } : null,
          amountCents: recoverCents > 0 ? recoverCents : forfeit,
          recovered: recoverCents > 0,
          reason: item.reason!.trim()
        });
      }
    }
    const after = yield* repo.listSessions({ disputeIds: [disputeId] });
    if (after.every((row) => row.allocation !== null)) {
      yield* repo.advanceTriage(disputeId, {
        from: ['allocation_needed'],
        set: { triage: 'resolved' }
      });
    }
    // Pay held while the dispute was undecided goes out (less any forfeit).
    yield* releaseHeldPay(disputeId, now);
    return allocated;
  });

export type SuspensionReason = 'unreliable_payment_method' | 'suspected_fraud';

const FAMILY_BILLING = 'family_billing';

/** The family's contracts an admin's suspension applies to: live, not
 * already held by an admin. */
const familyBillings = (familyUserId: string) =>
  ContractBillingRepo.pipe(Effect.flatMap((repo) => repo.listLiveBillingForFamily(familyUserId)));

/** An admin suspends the family's contracts during a card dispute (never
 * automatic): future cycles are not held or charged and their sessions are
 * suspended as they come; cycles already funded go ahead. Reason required,
 * audited; the family gets a neutral "under review" notice, the helper is
 * told not to work unfunded sessions. */
export const suspendFamilyContracts = (
  input: {
    familyUserId: string;
    reason: SuspensionReason;
    note: string;
    disputeId: string | null;
  },
  actorUserId: string,
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const suspended: Array<string> = [];
    for (const billing of yield* familyBillings(input.familyUserId)) {
      if (!['scheduled', 'active', 'suspended'].includes(billing.status)) continue;
      if (billing.suspendedReason === 'admin_review') continue;
      const moved = yield* repo.advanceBilling(billing.contractId, {
        from: [billing.status],
        set: {
          status: 'suspended',
          suspendedReason: 'admin_review',
          suspendedAt: billing.suspendedAt ?? now
        }
      });
      if (moved) suspended.push(billing.contractId);
    }
    if (suspended.length === 0) return yield* refuse('nothing_to_suspend');
    yield* (yield* SessionMoneyRepo).appendAudit({
      entity: FAMILY_BILLING,
      entityId: input.familyUserId,
      action: 'contracts_suspended',
      actorUserId,
      note: input.note,
      before: null,
      after: { reason: input.reason, contractIds: suspended, disputeId: input.disputeId }
    });
    const contracts = yield* ContractRepo;
    for (const contractId of suspended) {
      const contract = yield* contracts.findById(contractId);
      if (contract)
        yield* sendCardDisputeNotice('review_suspended', ['family', 'helper'], { contract });
    }
    yield* alertAdmins(`Family contracts suspended for review (${suspended.length})`, [
      `Reason: ${input.reason.replaceAll('_', ' ')} — ${input.note}`,
      `Contracts: ${suspended.join(', ')}. Only an admin can resume them.`
    ]);
    return suspended;
  });

/** An admin resumes the contracts they suspended (audited, both told). */
export const resumeFamilyContracts = (
  input: { familyUserId: string; note: string },
  actorUserId: string,
  now: Date
) =>
  Effect.gen(function* () {
    const resumed: Array<string> = [];
    for (const billing of yield* familyBillings(input.familyUserId)) {
      if (billing.status !== 'suspended' || billing.suspendedReason !== 'admin_review') continue;
      if (yield* resumeAfterAdminReview(billing.contractId, now)) resumed.push(billing.contractId);
    }
    if (resumed.length === 0) return yield* refuse('nothing_to_resume');
    yield* (yield* SessionMoneyRepo).appendAudit({
      entity: FAMILY_BILLING,
      entityId: input.familyUserId,
      action: 'contracts_resumed',
      actorUserId,
      note: input.note,
      before: null,
      after: { contractIds: resumed }
    });
    const contracts = yield* ContractRepo;
    for (const contractId of resumed) {
      const contract = yield* contracts.findById(contractId);
      if (contract)
        yield* sendCardDisputeNotice('review_resumed', ['family', 'helper'], { contract });
    }
    return resumed;
  });

/** Whether an admin holds the family's contracts, and the audit trail. */
export const familyReviewState = (familyUserId: string) =>
  Effect.gen(function* () {
    const billings = yield* familyBillings(familyUserId);
    const held = billings.filter(
      (row) => row.status === 'suspended' && row.suspendedReason === 'admin_review'
    );
    const audit = yield* (yield* SessionMoneyRepo).listAudit(FAMILY_BILLING, familyUserId);
    return {
      suspended: held.length > 0,
      contractIds: held.map((row) => row.contractId),
      suspendable: billings
        .filter(
          (row) =>
            ['scheduled', 'active', 'suspended'].includes(row.status) &&
            row.suspendedReason !== 'admin_review'
        )
        .map((row) => row.contractId),
      history: audit.map((event) => ({
        action: event.action,
        actorUserId: event.actorUserId,
        note: event.note,
        reason: (event.after as { reason?: SuspensionReason } | null)?.reason ?? null,
        at: event.createdAt
      }))
    };
  });

// ---------------------------------------------------------------------------
// The tick: evidence reminders

export type CardDisputeTickSummary = { reminded: number; failed: number };

/** Reminds the admins once, `CONTRACT_DISPUTE_EVIDENCE_REMINDER_HOURS`
 * before a dispute's evidence is due, while none was submitted. */
export const runCardDisputeTick = (now: Date) =>
  Effect.gen(function* () {
    const summary: CardDisputeTickSummary = { reminded: 0, failed: 0 };
    const { evidenceReminderHours } = yield* cardDisputePolicy;
    const repo = yield* CardDisputeRepo;
    const open = yield* repo.list({ open: true, triage: ['needs_response'] });
    for (const dispute of open) {
      const due = dispute.evidenceDueBy;
      if (due === null || now >= due) continue;
      if (now.getTime() < due.getTime() - evidenceReminderHours * 3_600_000) continue;
      const exit = yield* Effect.gen(function* () {
        const marked = yield* repo.appendNotice(dispute.id, `reminder:${due.toISOString()}`);
        if (marked === null) return;
        summary.reminded += 1;
        const hours = Math.max(1, Math.round((due.getTime() - now.getTime()) / 3_600_000));
        yield* alertAdmins(
          `Card dispute evidence due in ${hours} h: ${dollars(dispute.amountCents)} (${dispute.providerReference})`,
          [
            `No evidence has been submitted for the dispute on payment ${dispute.paymentId}; it is due by ${due.toISOString()}.`,
            'Without evidence the bank decides for the family. Review and submit it in Admin › Card disputes.'
          ]
        );
      }).pipe(Effect.exit);
      if (exit._tag === 'Failure') {
        summary.failed += 1;
        yield* Effect.logError(`[card-dispute] reminder for ${dispute.id} failed`, exit.cause);
      }
    }
    return summary;
  });
