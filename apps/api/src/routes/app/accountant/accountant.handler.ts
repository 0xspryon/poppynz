/**
 * The accountant's books (Tier 3 step 5, spec 2026-10-28 §1 step 5, §16):
 *
 *   GET  /accountant/access                          what the user may see and do
 *   GET  /accountant/reimbursements                  the obligations ledger (filters, totals)
 *   GET  /accountant/reimbursements.csv              the same, as CSV
 *   GET  /accountant/reimbursements/:key             one item with its full trail
 *   POST /accountant/reimbursements/:key/notes       add a note (audited)
 *   POST /accountant/reimbursements/:key/reconcile   mark (or unmark) reconciled (audited)
 *   GET  /accountant/reports/:report(.csv)           liabilities | refunds | absorbed | fees
 *   GET  /accountant/reconciliation(.csv)            a period's matched and unmatched items
 *   POST /accountant/reconciliation/runs             import the provider's transactions now
 *   POST /accountant/reconciliation/items/:key/resolve  resolve an unmatched item (audited)
 *
 * Governed by permissions only — `reimbursements` (read, note, reconcile)
 * and `reconciliation` (read, run, resolve), held by the accountant and
 * admins. Money moves only through the admin queues (`payoutQueue`,
 * `refundQueue`): nothing here sends, refunds or approves anything. Notes,
 * marks and resolutions name who made them, so they are refused while
 * impersonating (like tax writes).
 */
import type { SqlError } from '@effect/sql/SqlError';
import {
  absorbedByMonth,
  absorbedCsv,
  buildObligations,
  CardDisputeLedger,
  dayRange,
  feesByMonth,
  feesCsv,
  filterObligations,
  liabilitiesByMonth,
  liabilitiesCsv,
  monthsBetween,
  obligationsCsv,
  providerItem,
  refundsByMonth,
  refundsCsv,
  runReconciliation,
  settledStatuses,
  totalObligations,
  unmatchedOurs,
  csv,
  dollars,
  type Obligation,
  type ReconciliationItem
} from '@repo/billing';
import {
  AccountingRepo,
  OBLIGATION_AUDIT_ENTITY,
  RECONCILIATION_AUDIT_ENTITY,
  ReconciliationRepo,
  type BillingAuditEvent
} from '@repo/db';
import { reconciliationConfig } from '@repo/env';
import { Payments } from '@repo/payments';
import { Cause, ConfigError, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  AuthService,
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions,
  type Permissions
} from '@/api/lib/effect-auth';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import {
  noteError,
  reconcileError,
  resolveError,
  runError,
  validateItemKey,
  validateNote,
  validatePeriod,
  validateReconcile,
  validateReimbursementQuery,
  validateReportQuery,
  validateResolve,
  validateRun,
  type ReportKind
} from './accountant.validator';

export class AccountingRepoError extends Data.TaggedError('AccountingRepoError')<{
  cause: SqlError | ConfigError.ConfigError;
}> {}
export class ObligationNotFoundError extends Data.TaggedError('ObligationNotFoundError')<{
  key: string;
}> {}
/** Only a settled item (paid, handled, approved, repaid, absorbed, …) can
 * be marked reconciled. */
export class ObligationNotSettledError extends Data.TaggedError('ObligationNotSettledError')<{
  key: string;
}> {}
export class ReconciliationItemNotFoundError extends Data.TaggedError(
  'ReconciliationItemNotFoundError'
)<{ key: string }> {}
/** A matched item needs no resolution. */
export class ReconciliationItemMatchedError extends Data.TaggedError(
  'ReconciliationItemMatchedError'
)<{ key: string }> {}
/** `to` before `from`, or a longer range than allowed. */
export class AccountantRangeError extends Data.TaggedError('AccountantRangeError')<{
  maxDays: number;
}> {}
/** An import that would start in the future: nothing to read yet. */
export class ReconciliationFuturePeriodError extends Data.TaggedError(
  'ReconciliationFuturePeriodError'
)<{}> {}
/** Notes, marks and resolutions name their author: never while
 * impersonating. */
export class AccountantImpersonatedWriteError extends Data.TaggedError(
  'AccountantImpersonatedWriteError'
)<{}> {}

const repoFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is Extract<E, SqlError> => (error as { _tag?: string })?._tag === 'SqlError',
      (cause) => Effect.fail(new AccountingRepoError({ cause: cause as SqlError }))
    )
  ) as Effect.Effect<A, Exclude<E, SqlError> | AccountingRepoError, R>;

const configFailure = <A, E, R>(effect: Effect.Effect<A, E | ConfigError.ConfigError, R>) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is ConfigError.ConfigError => ConfigError.isConfigError(error),
      (cause) => Effect.fail(new AccountingRepoError({ cause }))
    )
  ) as Effect.Effect<A, Exclude<E, ConfigError.ConfigError> | AccountingRepoError, R>;

const gate = (headers: Headers, permissions: Permissions) =>
  Effect.flatMap(authenticate(headers), requirePermissions(headers, permissions));

const writeGate = (headers: Headers, permissions: Permissions) =>
  gate(headers, permissions).pipe(
    Effect.filterOrFail(
      (userAndSession) => !userAndSession.session.impersonatedBy,
      () => new AccountantImpersonatedWriteError()
    )
  );

/** The longest on-screen report or reconciliation view (as the tax report). */
const MAX_VIEW_DAYS = 3 * 366;

const checkRange = (from: string, to: string, maxDays: number) => {
  const days =
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000;
  return days < 0 || days > maxDays
    ? Effect.fail(new AccountantRangeError({ maxDays }))
    : Effect.void;
};

// ---------------------------------------------------------------------------
// Presentation

const iso = (at: Date | null) => (at ? at.toISOString() : null);

export const obligationView = (item: Obligation) => ({
  key: item.key,
  type: item.type,
  id: item.id,
  direction: item.direction,
  status: item.status,
  baseStatus: item.baseStatus,
  amountCents: item.amountCents,
  outstandingCents: item.outstandingCents,
  occurredAt: item.occurredAt.toISOString(),
  settledAt: iso(item.settledAt),
  contractId: item.contractId,
  cycleId: item.cycleId,
  cycleLabel: item.cycleLabel,
  sessionId: item.sessionId,
  sessionDate: item.sessionDate,
  serviceName: item.serviceName,
  paymentId: item.paymentId,
  paymentReference: item.paymentReference,
  providerObject: item.providerObject,
  familyName: item.familyName,
  helperName: item.helperName,
  cause: item.cause,
  detail: item.detail,
  reconciled: item.reconciled
    ? {
        at: item.reconciled.at.toISOString(),
        by: item.reconciled.actorName ?? item.reconciled.actorUserId,
        note: item.reconciled.note
      }
    : null,
  notes: item.notes,
  canReconcile: settledStatuses.includes(item.baseStatus)
});

const eventView = (event: BillingAuditEvent, names: Map<string, string>) => ({
  id: event.id,
  entity: event.entity,
  action: event.action,
  by: event.actorUserId ? (names.get(event.actorUserId) ?? event.actorUserId) : null,
  note: event.note,
  at: event.createdAt.toISOString()
});

const loadObligations = Effect.gen(function* () {
  const sources = yield* (yield* AccountingRepo).listSources();
  const disputes = yield* (yield* CardDisputeLedger).listBorneByPoppynz();
  return { sources, items: buildObligations(sources, disputes) };
}).pipe((errors) => repoFailure(errors));

// ---------------------------------------------------------------------------
// Programs

/** What the signed-in user may see and do across the accountant area —
 * drives its navigation for accountants and admins alike. */
export const getAccountantAccessRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    yield* authenticate(headers);
    const auth = yield* AuthService;
    const can = (permissions: Permissions) => auth.userHasPermission(headers, permissions);
    const flags = yield* Effect.all({
      taxRead: can({ tax: ['read'] }),
      taxReport: can({ taxReport: ['read'] }),
      refundQueue: can({ refundQueue: ['read'] }),
      cardDisputeFinance: can({ cardDispute: ['read', 'finance'] }),
      reimbursementsRead: can({ reimbursements: ['read'] }),
      reimbursementsNote: can({ reimbursements: ['note'] }),
      reimbursementsReconcile: can({ reimbursements: ['reconcile'] }),
      reconciliationRead: can({ reconciliation: ['read'] }),
      reconciliationRun: can({ reconciliation: ['run'] }),
      reconciliationResolve: can({ reconciliation: ['resolve'] })
    });
    return flags;
  });

export const listReimbursementsProgram = (
  query: Effect.Effect.Success<ReturnType<typeof validateReimbursementQuery>>
) =>
  Effect.gen(function* () {
    const { items } = yield* loadObligations;
    const filtered = filterObligations(items, {
      types: query.type,
      statuses: query.status,
      from: query.from,
      to: query.to,
      party: query.party,
      contractId: query.contract
    });
    return { items: filtered, totals: totalObligations(filtered) };
  });

const reimbursementQueryOf = (query: Record<string, string | undefined>) =>
  validateReimbursementQuery(
    Object.fromEntries(
      Object.entries(query).filter(([, value]) => value !== undefined && value !== '')
    )
  );

export const listReimbursementsRouteProgram = (
  headers: Headers,
  query: Record<string, string | undefined>
) =>
  Effect.gen(function* () {
    const input = yield* reimbursementQueryOf(query);
    yield* gate(headers, { reimbursements: ['read'] });
    const { items, totals } = yield* listReimbursementsProgram(input);
    return { items: items.map(obligationView), totals };
  });

export const reimbursementsCsvRouteProgram = (
  headers: Headers,
  query: Record<string, string | undefined>
) =>
  Effect.gen(function* () {
    const input = yield* reimbursementQueryOf(query);
    yield* gate(headers, { reimbursements: ['read'] });
    const { items } = yield* listReimbursementsProgram(input);
    return obligationsCsv(items);
  });

const findObligation = (key: string) =>
  Effect.gen(function* () {
    const { sources, items } = yield* loadObligations;
    const item = items.find((row) => row.key === key);
    if (!item) return yield* Effect.fail(new ObligationNotFoundError({ key }));
    return { sources, item };
  });

/** One item with its full trail: the row's own audit, the session's
 * resolutions, ledger entries and transfer items, and the accountant's
 * notes and marks. */
export const getReimbursementProgram = (key: string) =>
  Effect.gen(function* () {
    const { sources, item } = yield* findObligation(key);
    const trail = yield* (yield* AccountingRepo)
      .trail({
        audit: [...item.audit, { entity: OBLIGATION_AUDIT_ENTITY, entityId: item.key }],
        sessionId: item.sessionId,
        cycleId: item.sessionId ? null : item.cycleId
      })
      .pipe((errors) => repoFailure(errors));
    const names = new Map(sources.users.map((row) => [row.id, row.name]));
    const marks = trail.audit.filter((row) => row.entity === OBLIGATION_AUDIT_ENTITY);
    return {
      item: obligationView(item),
      notes: marks.filter((row) => row.action === 'note').map((row) => eventView(row, names)),
      trail: {
        events: trail.audit.map((row) => eventView(row, names)),
        resolutions: trail.resolutions.map((row) => ({
          id: row.id,
          kind: row.kind,
          status: row.status,
          decision: row.decision,
          recordedAt: row.recordedAt.toISOString(),
          decidedAt: iso(row.decidedAt)
        })),
        ledger: trail.ledger.map((row) => ({
          id: row.id,
          kind: row.kind,
          party: row.party,
          amountCents: row.amountCents,
          label: row.label,
          paymentId: row.paymentId,
          at: row.createdAt.toISOString()
        })),
        transferItems: trail.transferItems.map((row) => {
          const transfer = sources.transfers.find((t) => t.id === row.transferId);
          return {
            id: row.id,
            kind: row.kind,
            amountCents: row.amountCents,
            transferId: row.transferId,
            transferStatus: transfer?.status ?? null,
            transferReference: transfer?.providerReference ?? null,
            payoutReference: transfer?.payoutReference ?? null,
            payoutMatch: transfer?.payoutMatch ?? null,
            at: row.createdAt.toISOString()
          };
        })
      }
    };
  });

export const getReimbursementRouteProgram = (headers: Headers, rawKey: string | undefined) =>
  Effect.gen(function* () {
    const key = yield* validateItemKey(rawKey);
    yield* gate(headers, { reimbursements: ['read'] });
    return yield* getReimbursementProgram(key);
  });

export const addReimbursementNoteProgram = (actorUserId: string, key: string, note: string) =>
  Effect.gen(function* () {
    yield* findObligation(key);
    const event = yield* (yield* AccountingRepo)
      .appendMark({
        entity: OBLIGATION_AUDIT_ENTITY,
        entityId: key,
        action: 'note',
        actorUserId,
        note
      })
      .pipe((errors) => repoFailure(errors));
    return { note: { id: event.id, at: event.createdAt.toISOString(), note: event.note } };
  });

export const addReimbursementNoteRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const key = yield* validateItemKey(c.req.param('key'));
    const input = yield* validateNote(yield* parseJsonBody(c, noteError));
    const actor = yield* writeGate(headers, { reimbursements: ['read', 'note'] });
    return yield* addReimbursementNoteProgram(actor.user.id, key, input.note);
  });

/** Marks a settled item reconciled (or takes the mark back), appended to
 * the money audit with the item as it stood. */
export const reconcileReimbursementProgram = (
  actorUserId: string,
  key: string,
  input: { reconciled: boolean; note?: string | null }
) =>
  Effect.gen(function* () {
    const { item } = yield* findObligation(key);
    if (!settledStatuses.includes(item.baseStatus)) {
      return yield* Effect.fail(new ObligationNotSettledError({ key }));
    }
    const already = item.reconciled !== null;
    if (already !== input.reconciled) {
      yield* (yield* AccountingRepo)
        .appendMark({
          entity: OBLIGATION_AUDIT_ENTITY,
          entityId: key,
          action: input.reconciled ? 'reconciled' : 'unreconciled',
          actorUserId,
          note: input.note?.trim() ? input.note.trim() : null,
          before: JSON.parse(JSON.stringify(obligationView(item))) as Record<string, unknown>
        })
        .pipe((errors) => repoFailure(errors));
    }
    const { item: after } = yield* findObligation(key);
    return { item: obligationView(after) };
  });

export const reconcileReimbursementRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const key = yield* validateItemKey(c.req.param('key'));
    const input = yield* validateReconcile(yield* parseJsonBody(c, reconcileError));
    const actor = yield* writeGate(headers, { reimbursements: ['read', 'reconcile'] });
    return yield* reconcileReimbursementProgram(actor.user.id, key, input);
  });

// Reports ---------------------------------------------------------------

export type AccountantReport =
  | { report: 'liabilities'; rows: ReturnType<typeof liabilitiesByMonth> }
  | { report: 'refunds'; rows: ReturnType<typeof refundsByMonth> }
  | { report: 'absorbed'; rows: ReturnType<typeof absorbedByMonth> }
  | { report: 'fees'; rows: ReturnType<typeof feesByMonth>['rows']; gaps: Array<string> };

export const reportProgram = (report: ReportKind, from: string, to: string, now: Date) =>
  Effect.gen(function* () {
    const months = monthsBetween(from, to);
    if (report === 'fees') {
      const payments = yield* Payments;
      const range = dayRange(`${months[0]}-01`, to);
      const transactions = yield* (yield* ReconciliationRepo)
        .listTransactions({ provider: payments.provider, from: range.from, to: range.to })
        .pipe((errors) => repoFailure(errors));
      const fees = feesByMonth(transactions, months);
      return {
        report: 'fees',
        provider: payments.provider,
        rows: fees.rows,
        gaps: fees.gaps
      } as const;
    }
    const sources = yield* (yield* AccountingRepo)
      .listSources()
      .pipe((errors) => repoFailure(errors));
    if (report === 'liabilities') {
      return { report, rows: liabilitiesByMonth(sources, months, now) } as const;
    }
    if (report === 'refunds') return { report, rows: refundsByMonth(sources, months) } as const;
    const disputes = yield* (yield* CardDisputeLedger)
      .listBorneByPoppynz()
      .pipe((errors) => repoFailure(errors));
    return { report: 'absorbed', rows: absorbedByMonth(sources, disputes, months) } as const;
  });

export const reportRouteProgram = (
  headers: Headers,
  query: { report?: string; from?: string; to?: string },
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const input = yield* validateReportQuery(query);
    yield* gate(headers, { reimbursements: ['read'] });
    yield* checkRange(input.from, input.to, MAX_VIEW_DAYS);
    const result = yield* reportProgram(input.report, input.from, input.to, now);
    return { from: input.from, to: input.to, ...result };
  });

export const reportCsv = (result: Effect.Effect.Success<ReturnType<typeof reportProgram>>) => {
  switch (result.report) {
    case 'liabilities':
      return liabilitiesCsv(result.rows);
    case 'refunds':
      return refundsCsv(result.rows);
    case 'absorbed':
      return absorbedCsv(result.rows);
    case 'fees':
      return feesCsv(result.rows);
  }
};

// Reconciliation --------------------------------------------------------

const resolutionsByKey = (marks: ReadonlyArray<BillingAuditEvent>) => {
  const latest = new Map<string, BillingAuditEvent | null>();
  for (const mark of marks) {
    if (mark.action === 'resolved') latest.set(mark.entityId, mark);
    if (mark.action === 'reopened') latest.set(mark.entityId, null);
  }
  return latest;
};

const withResolution = (
  item: ReconciliationItem,
  marks: Map<string, BillingAuditEvent | null>
): ReconciliationItem => {
  const mark = item.status === 'matched' ? null : (marks.get(item.key) ?? null);
  return mark
    ? {
        ...item,
        status: 'resolved',
        resolution: { at: mark.createdAt, actorUserId: mark.actorUserId, note: mark.note }
      }
    : item;
};

/** A period's reconciliation: what was imported and how it matched, our
 * records the provider didn't list, and the runs. */
export const reconciliationViewProgram = (from: string, to: string, view: 'exceptions' | 'all') =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* ReconciliationRepo;
    const range = dayRange(from, to);
    // The provider's side, with a few days' slack either side for our
    // records near the edges.
    const slack = 3 * 86_400_000;
    const [imported, wide, ours, runs, marks] = yield* Effect.all([
      repo.listTransactions({ provider: payments.provider, from: range.from, to: range.to }),
      repo.listTransactions({
        provider: payments.provider,
        from: new Date(range.from.getTime() - slack),
        to: new Date(range.to.getTime() + slack)
      }),
      repo.ourRecordsBetween({ provider: payments.provider, from: range.from, to: range.to }),
      repo.listRuns(payments.provider, 10),
      (yield* AccountingRepo).listMarks(RECONCILIATION_AUDIT_ENTITY)
    ]).pipe((errors) => repoFailure(errors));
    const resolutions = resolutionsByKey(marks);
    const all = [...imported.map((row) => providerItem(row)), ...unmatchedOurs(ours, wide)].map(
      (item) => withResolution(item, resolutions)
    );
    const count = (status: ReconciliationItem['status']) =>
      all.filter((item) => item.status === status).length;
    return {
      provider: payments.provider,
      summary: {
        imported: imported.length,
        matched: count('matched'),
        unmatched: count('unmatched'),
        mismatch: count('mismatch'),
        resolved: count('resolved'),
        oursUnmatched: all.filter((item) => item.side === 'ours' && item.status === 'unmatched')
          .length
      },
      items: (view === 'all'
        ? all
        : all.filter(
            (item) =>
              item.status === 'unmatched' ||
              item.status === 'mismatch' ||
              item.status === 'resolved'
          )
      ).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
      runs: runs.map((run) => ({
        id: run.id,
        trigger: run.trigger,
        status: run.status,
        periodFrom: run.periodFrom.toISOString(),
        periodTo: run.periodTo.toISOString(),
        importedCount: run.importedCount,
        matchedCount: run.matchedCount,
        unmatchedCount: run.unmatchedCount,
        payoutsExactCount: run.payoutsExactCount,
        error: run.error,
        startedAt: run.startedAt.toISOString(),
        finishedAt: iso(run.finishedAt)
      }))
    };
  });

const reconciliationItemView = (item: ReconciliationItem) => ({
  ...item,
  occurredAt: item.occurredAt.toISOString(),
  resolution: item.resolution
    ? {
        at: item.resolution.at.toISOString(),
        by: item.resolution.actorUserId,
        note: item.resolution.note
      }
    : null
});

export const reconciliationRouteProgram = (
  headers: Headers,
  query: { from?: string; to?: string; view?: string }
) =>
  Effect.gen(function* () {
    const input = yield* validatePeriod(
      Object.fromEntries(Object.entries(query).filter(([, value]) => value))
    );
    yield* gate(headers, { reconciliation: ['read'] });
    yield* checkRange(input.from, input.to, MAX_VIEW_DAYS);
    const result = yield* reconciliationViewProgram(
      input.from,
      input.to,
      input.view ?? 'exceptions'
    );
    return {
      from: input.from,
      to: input.to,
      ...result,
      items: result.items.map(reconciliationItemView)
    };
  });

export const reconciliationCsv = (items: ReadonlyArray<ReconciliationItem>) =>
  csv(
    [
      'key',
      'side',
      'kind',
      'reference',
      'amount_cad',
      'fee_cad',
      'occurred_at',
      'status',
      'matched_to',
      'matched_id',
      'account',
      'payout',
      'note',
      'resolution_note'
    ],
    items.map((item) => [
      item.key,
      item.side,
      item.kind,
      item.reference,
      dollars(item.amountCents),
      dollars(item.feeCents),
      item.occurredAt.toISOString(),
      item.status,
      item.matchKind,
      item.matchedId,
      item.account,
      item.payoutReference,
      item.note,
      item.resolution?.note ?? null
    ])
  );

export const reconciliationCsvRouteProgram = (
  headers: Headers,
  query: { from?: string; to?: string; view?: string }
) =>
  Effect.gen(function* () {
    const input = yield* validatePeriod(
      Object.fromEntries(Object.entries(query).filter(([, value]) => value))
    );
    yield* gate(headers, { reconciliation: ['read'] });
    yield* checkRange(input.from, input.to, MAX_VIEW_DAYS);
    const result = yield* reconciliationViewProgram(input.from, input.to, input.view ?? 'all');
    return { from: input.from, to: input.to, text: reconciliationCsv(result.items) };
  });

/** An on-demand import for a period (Toronto dates, inclusive). */
export const runReconciliationRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const input = yield* validateRun(yield* parseJsonBody(c, runError));
    const actor = yield* writeGate(headers, { reconciliation: ['read', 'run'] });
    const config = yield* configFailure(reconciliationConfig);
    yield* checkRange(input.from, input.to, config.maxRangeDays);
    const range = dayRange(input.from, input.to);
    if (range.from >= now) return yield* Effect.fail(new ReconciliationFuturePeriodError());
    const summary = yield* runReconciliation({
      trigger: 'manual',
      requestedByUserId: actor.user.id,
      from: range.from,
      to: range.to < now ? range.to : now,
      now
    }).pipe(
      (errors) => repoFailure(errors),
      (errors) => configFailure(errors)
    );
    return {
      run: {
        id: summary.run.id,
        status: summary.run.status,
        imported: summary.imported,
        matched: summary.matched,
        unmatched: summary.unmatched,
        payoutsExact: summary.payoutsExact,
        error: summary.run.error
      }
    };
  });

/** Resolves (or reopens) an unmatched or mismatched item with a note. */
export const resolveReconciliationItemProgram = (
  actorUserId: string,
  key: string,
  input: { resolved?: boolean; note: string }
) =>
  Effect.gen(function* () {
    const repo = yield* ReconciliationRepo;
    if (key.startsWith('txn:')) {
      const row = yield* repo
        .findTransaction(key.slice('txn:'.length))
        .pipe((errors) => repoFailure(errors));
      if (!row) return yield* Effect.fail(new ReconciliationItemNotFoundError({ key }));
      if (row.matchStatus === 'matched') {
        return yield* Effect.fail(new ReconciliationItemMatchedError({ key }));
      }
    } else if (
      !/^(payment|payment_refund|session_refund|helper_transfer):[0-9a-f-]{36}$/.test(key)
    ) {
      return yield* Effect.fail(new ReconciliationItemNotFoundError({ key }));
    }
    const event = yield* (yield* AccountingRepo)
      .appendMark({
        entity: RECONCILIATION_AUDIT_ENTITY,
        entityId: key,
        action: input.resolved === false ? 'reopened' : 'resolved',
        actorUserId,
        note: input.note
      })
      .pipe((errors) => repoFailure(errors));
    return {
      resolution: {
        key,
        action: event.action,
        note: event.note,
        at: event.createdAt.toISOString()
      }
    };
  });

export const resolveReconciliationItemRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const key = yield* validateItemKey(c.req.param('key'));
    const input = yield* validateResolve(yield* parseJsonBody(c, resolveError));
    const actor = yield* writeGate(headers, { reconciliation: ['read', 'resolve'] });
    return yield* resolveReconciliationItemProgram(actor.user.id, key, input);
  });

// ---------------------------------------------------------------------------
// Responses

export type AccountantRouteError =
  | Effect.Effect.Error<ReturnType<typeof getAccountantAccessRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listReimbursementsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof reimbursementsCsvRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getReimbursementRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof addReimbursementNoteRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof reconcileReimbursementRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof reportRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof reconciliationRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof reconciliationCsvRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof runReconciliationRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof resolveReconciliationItemRouteProgram>>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: AccountantRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'AccountantImpersonatedWriteError':
      return c.json(
        {
          error: {
            code: 'ACCOUNTANT_WRITE_IMPERSONATED' as const,
            message: 'Notes and marks cannot be made while impersonating. Sign in as yourself.'
          }
        },
        403
      );
    case 'ObligationNotFoundError':
      return c.json(
        { error: { code: 'REIMBURSEMENT_NOT_FOUND' as const, message: 'No such item.' } },
        404
      );
    case 'ObligationNotSettledError':
      return c.json(
        {
          error: {
            code: 'REIMBURSEMENT_NOT_SETTLED' as const,
            message:
              'Only a settled item (paid, handled, approved, repaid or absorbed) can be reconciled.'
          }
        },
        409
      );
    case 'ReconciliationItemNotFoundError':
      return c.json(
        { error: { code: 'RECONCILIATION_ITEM_NOT_FOUND' as const, message: 'No such item.' } },
        404
      );
    case 'ReconciliationItemMatchedError':
      return c.json(
        {
          error: {
            code: 'RECONCILIATION_ITEM_MATCHED' as const,
            message: 'This item is matched; there is nothing to resolve.'
          }
        },
        409
      );
    case 'AccountantRangeError':
      return c.json(
        {
          error: {
            code: 'ACCOUNTANT_RANGE_INVALID' as const,
            message: `Pick an end date on or after the start date, at most ${error.maxDays} days later.`
          }
        },
        422
      );
    case 'ReconciliationFuturePeriodError':
      return c.json(
        {
          error: {
            code: 'RECONCILIATION_PERIOD_IN_FUTURE' as const,
            message: 'The period starts in the future: there is nothing to import yet.'
          }
        },
        422
      );
    case 'ReconciliationBusyError':
      return c.json(
        {
          error: {
            code: 'RECONCILIATION_BUSY' as const,
            message: 'A reconciliation is already running. Try again in a few minutes.'
          }
        },
        409
      );
    case 'AccountingRepoError':
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, AccountantRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return errorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

const csvResponse = (c: HonoContext<HonoEnv>, text: string, filename: string) =>
  c.body(text, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`
  });

const queryOf = (c: HonoContext<HonoEnv>) => c.req.query();

export async function getAccountantAccessHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(getAccountantAccessRouteProgram(c.req.raw.headers))
  );
}

export async function listReimbursementsHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c
      .get('runtime')
      .runPromiseExit(listReimbursementsRouteProgram(c.req.raw.headers, queryOf(c)))
  );
}

export async function reimbursementsCsvHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(reimbursementsCsvRouteProgram(c.req.raw.headers, queryOf(c)));
  if (Exit.isSuccess(exit)) return csvResponse(c, exit.value, 'reimbursements.csv');
  return exitToResponse(c, exit);
}

export async function getReimbursementHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c
      .get('runtime')
      .runPromiseExit(getReimbursementRouteProgram(c.req.raw.headers, c.req.param('key')))
  );
}

export async function addReimbursementNoteHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(addReimbursementNoteRouteProgram(c, c.req.raw.headers))
  );
}

export async function reconcileReimbursementHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(reconcileReimbursementRouteProgram(c, c.req.raw.headers))
  );
}

const reportQuery = (c: HonoContext<HonoEnv>) => ({
  report: c.req.param('report')?.replace(/\.csv$/, ''),
  from: c.req.query('from'),
  to: c.req.query('to')
});

export async function reportHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(reportRouteProgram(c.req.raw.headers, reportQuery(c)))
  );
}

export async function reportCsvHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(reportRouteProgram(c.req.raw.headers, reportQuery(c)));
  if (Exit.isSuccess(exit)) {
    const result = exit.value;
    return csvResponse(c, reportCsv(result), `${result.report}-${result.from}-to-${result.to}.csv`);
  }
  return exitToResponse(c, exit);
}

const periodQuery = (c: HonoContext<HonoEnv>) => ({
  from: c.req.query('from'),
  to: c.req.query('to'),
  view: c.req.query('view')
});

export async function reconciliationHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c
      .get('runtime')
      .runPromiseExit(reconciliationRouteProgram(c.req.raw.headers, periodQuery(c)))
  );
}

export async function reconciliationCsvHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(reconciliationCsvRouteProgram(c.req.raw.headers, periodQuery(c)));
  if (Exit.isSuccess(exit)) {
    return csvResponse(
      c,
      exit.value.text,
      `reconciliation-${exit.value.from}-to-${exit.value.to}.csv`
    );
  }
  return exitToResponse(c, exit);
}

export async function runReconciliationHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(runReconciliationRouteProgram(c, c.req.raw.headers))
  );
}

export async function resolveReconciliationItemHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c
      .get('runtime')
      .runPromiseExit(resolveReconciliationItemRouteProgram(c, c.req.raw.headers))
  );
}
