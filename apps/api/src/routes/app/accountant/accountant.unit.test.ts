import {
  absorbedEntry,
  accountingSources,
  ACCOUNTING_IDS,
  makeCardDisputeLedgerTest,
  manualPayoutRow,
  recoveryRow,
  refundRow,
  transferRow
} from '@repo/billing';
import {
  makeInMemoryAccountingRepo,
  makeInMemoryReconciliationRepo,
  makeSessionRepoTest,
  makeUserRepoTest,
  type Session,
  type User
} from '@repo/db';
import { makeMockPayments, Payments, type ProviderBalanceTransaction } from '@repo/payments';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { roles } from '@/api/lib/auth-roles';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  addReimbursementNoteRouteProgram,
  getAccountantAccessRouteProgram,
  getReimbursementRouteProgram,
  listReimbursementsRouteProgram,
  reconcileReimbursementRouteProgram,
  reconciliationCsvRouteProgram,
  reconciliationRouteProgram,
  reimbursementsCsvRouteProgram,
  reportRouteProgram,
  resolveReconciliationItemRouteProgram,
  runReconciliationRouteProgram
} from './accountant.handler';

/** Tier 3 step 5: the accountant's books. Permissions come from the real
 * roles, so these tests break if a role loses (or gains) access. */
const grantsOf = (role: keyof typeof roles) =>
  Object.entries(roles[role].statements as Record<string, ReadonlyArray<string>>).flatMap(
    ([resource, actions]) => actions.map((action) => `${resource}:${action}`)
  );

const NOW = new Date('2026-12-15T12:00:00.000Z');
const OK_REFUND = refundRow({ id: '0198b000-0000-7000-8000-00000000f001' });
const FAILED_REFUND = refundRow({
  id: '0198b000-0000-7000-8000-00000000f002',
  status: 'failed',
  refundedAt: null,
  failureReason: 'card closed'
});

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const found = Cause.failureOption(exit.cause);
  return Option.isSome(found) ? (found.value as { _tag: string }) : null;
};

const context = (params: Record<string, string>, body?: unknown) =>
  ({
    req: { param: (key: string) => params[key], json: async () => body }
  }) as unknown as HonoContext<HonoEnv>;

const txn = (reference: string, overrides: Partial<ProviderBalanceTransaction> = {}) =>
  ({
    reference,
    type: 'charge',
    reportingCategory: 'charge',
    amountCents: 13206,
    feeCents: 413,
    netCents: 12793,
    currency: 'cad',
    status: 'available',
    createdAt: new Date('2026-12-02T12:00:00.000Z'),
    availableOn: new Date('2026-12-04T00:00:00.000Z'),
    description: null,
    sourceReference: `ch_${reference}`,
    sourceType: 'charge',
    paymentReference: `pi_${reference}`,
    transferReference: null,
    feeDetails: [],
    ...overrides
  }) satisfies ProviderBalanceTransaction;

const makeWorld = () => {
  const accounting = makeInMemoryAccountingRepo(
    accountingSources({
      refunds: [OK_REFUND, FAILED_REFUND],
      recoveries: [recoveryRow()],
      transfers: [transferRow()],
      manualPayouts: [manualPayoutRow()],
      absorbed: [absorbedEntry()]
    })
  );
  const payments = makeMockPayments();
  payments.setBalanceTransactions(null, [
    txn('known'),
    txn('stray'),
    txn('fee', {
      type: 'stripe_fee',
      reportingCategory: 'fee',
      amountCents: -25,
      feeCents: 0,
      netCents: -25,
      sourceReference: null,
      sourceType: null,
      paymentReference: null
    })
  ]);
  const reconciliation = makeInMemoryReconciliationRepo({
    payments: [
      {
        id: '0198b000-0000-7000-8000-00000000a001',
        kind: 'contract_cycle',
        providerReference: 'pi_known',
        refundReference: null,
        status: 'captured',
        totalCents: 13206,
        capturedCents: 13206,
        capturedAt: new Date('2026-12-02T12:00:00.000Z'),
        refundedAt: null
      },
      {
        id: '0198b000-0000-7000-8000-00000000a002',
        kind: 'contract_cycle',
        providerReference: 'pi_lost',
        refundReference: null,
        status: 'captured',
        totalCents: 500,
        capturedCents: 500,
        capturedAt: new Date('2026-12-03T12:00:00.000Z'),
        refundedAt: null
      }
    ]
  });
  const as = (
    userId: string,
    grants: ReadonlyArray<string>,
    options: { impersonatedBy?: string } = {}
  ) =>
    Layer.mergeAll(
      accounting.layer,
      reconciliation.layer,
      Layer.succeed(Payments, payments),
      makeCardDisputeLedgerTest(),
      makeAuthServiceTest({
        getSession: () => Effect.succeed({ user: { id: userId }, session: { id: 'session-1' } }),
        userHasPermission: (_headers, permissions) =>
          Effect.succeed(
            Object.entries(permissions).every(([resource, actions]) =>
              (actions as Array<string>).every((action) => grants.includes(`${resource}:${action}`))
            )
          )
      }),
      makeUserRepoTest({
        findById: (id) => Effect.succeed({ id, name: id, email: `${id}@x.test` } as User),
        findByEmail: () => Effect.die('unused')
      }),
      makeSessionRepoTest({
        findById: () =>
          Effect.succeed({
            id: 'session-1',
            userId,
            ...(options.impersonatedBy ? { impersonatedBy: options.impersonatedBy } : {})
          } as Session)
      })
    );
  return { accounting, reconciliation, payments, as };
};

const ACCOUNTANT = grantsOf('accountant');
const ADMIN = grantsOf('admin');
const FAMILY = grantsOf('family');
const HELPER = grantsOf('service-provider');

describe('access to the accountant’s books', () => {
  it('is granted to the accountant and admins by permission, never to families or helpers', async () => {
    const world = makeWorld();
    const list = (grants: ReadonlyArray<string>) =>
      Effect.runPromiseExit(
        listReimbursementsRouteProgram(new Headers(), {}).pipe(
          Effect.provide(world.as('someone', grants))
        )
      );
    expect((await list(ACCOUNTANT))._tag).toBe('Success');
    expect((await list(ADMIN))._tag).toBe('Success');
    expect(failure(await list(FAMILY))?._tag).toBe('ForbiddenError');
    expect(failure(await list(HELPER))?._tag).toBe('ForbiddenError');
    const view = (grants: ReadonlyArray<string>) =>
      Effect.runPromiseExit(
        reconciliationRouteProgram(new Headers(), { from: '2026-12-01', to: '2026-12-31' }).pipe(
          Effect.provide(world.as('someone', grants))
        )
      );
    expect((await view(ACCOUNTANT))._tag).toBe('Success');
    expect(failure(await view(FAMILY))?._tag).toBe('ForbiddenError');
  });

  it('reports what each may do, for the navigation', async () => {
    const world = makeWorld();
    const accountant = await Effect.runPromise(
      getAccountantAccessRouteProgram(new Headers()).pipe(
        Effect.provide(world.as(ACCOUNTING_IDS.accountant, ACCOUNTANT))
      )
    );
    expect(accountant).toEqual({
      taxRead: true,
      taxReport: true,
      refundQueue: true,
      cardDisputeFinance: true,
      reimbursementsRead: true,
      reimbursementsNote: true,
      reimbursementsReconcile: true,
      reconciliationRead: true,
      reconciliationRun: true,
      reconciliationResolve: true
    });
    const family = await Effect.runPromise(
      getAccountantAccessRouteProgram(new Headers()).pipe(
        Effect.provide(world.as(ACCOUNTING_IDS.family, FAMILY))
      )
    );
    expect(Object.values(family).every((flag) => flag === false)).toBe(true);
  });
});

describe('the reimbursements ledger', () => {
  it('lists every item with its status and totals, filtered by the query', async () => {
    const world = makeWorld();
    const all = await Effect.runPromise(
      listReimbursementsRouteProgram(new Headers(), {}).pipe(
        Effect.provide(world.as(ACCOUNTING_IDS.accountant, ACCOUNTANT))
      )
    );
    expect(all.items.map((item) => [item.type, item.status]).sort()).toEqual(
      [
        ['absorbed', 'absorbed'],
        ['family_refund', 'failed'],
        ['family_refund', 'paid'],
        ['helper_recovery', 'outstanding'],
        ['manual_payout', 'recorded']
      ].sort()
    );
    expect(all.totals).toMatchObject({ count: 5, outstandingPayableCents: 5041 + 10531 });
    const failed = await Effect.runPromise(
      listReimbursementsRouteProgram(new Headers(), {
        type: 'family_refund',
        status: 'failed',
        party: 'fiona'
      }).pipe(Effect.provide(world.as(ACCOUNTING_IDS.accountant, ACCOUNTANT)))
    );
    expect(failed.items.map((item) => item.id)).toEqual([FAILED_REFUND.id]);
    expect(failed.items[0]).toMatchObject({ detail: 'card closed', canReconcile: false });
  });

  it('refuses unknown filters', async () => {
    const world = makeWorld();
    const exit = await Effect.runPromiseExit(
      listReimbursementsRouteProgram(new Headers(), { type: 'bonus' }).pipe(
        Effect.provide(world.as(ACCOUNTING_IDS.accountant, ACCOUNTANT))
      )
    );
    expect(failure(exit)?._tag).toBe('RequestValidationError');
  });

  it('exports the filtered list as CSV', async () => {
    const world = makeWorld();
    const text = await Effect.runPromise(
      reimbursementsCsvRouteProgram(new Headers(), { type: 'helper_recovery' }).pipe(
        Effect.provide(world.as(ACCOUNTING_IDS.admin, ADMIN))
      )
    );
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('helper_recovery,outstanding,receivable,42.12,42.12');
  });

  it('opens one item with its trail and notes; notes and marks are audited', async () => {
    const world = makeWorld();
    const key = `family_refund:${OK_REFUND.id}`;
    const as = world.as(ACCOUNTING_IDS.accountant, ACCOUNTANT);
    const noted = await Effect.runPromiseExit(
      addReimbursementNoteRouteProgram(
        context({ key }, { note: 'On the Dec statement' }),
        new Headers()
      ).pipe(Effect.provide(as))
    );
    expect(noted._tag).toBe('Success');
    const reconciled = await Effect.runPromise(
      reconcileReimbursementRouteProgram(
        context({ key }, { reconciled: true, note: 'bank line 14' }),
        new Headers()
      ).pipe(Effect.provide(as))
    );
    expect(reconciled.item).toMatchObject({
      status: 'reconciled',
      reconciled: { by: 'Ada Accountant', note: 'bank line 14' }
    });
    const detail = await Effect.runPromise(
      getReimbursementRouteProgram(new Headers(), key).pipe(Effect.provide(as))
    );
    expect(detail.item.notes).toBe(1);
    expect(detail.notes.map((row) => [row.note, row.by])).toEqual([
      ['On the Dec statement', 'Ada Accountant']
    ]);
    expect(detail.trail.events.map((row) => row.action)).toEqual(['note', 'reconciled']);
    expect(
      world.accounting.marks.map((row) => [row.entity, row.entityId, row.action, row.actorUserId])
    ).toEqual([
      ['obligation', key, 'note', ACCOUNTING_IDS.accountant],
      ['obligation', key, 'reconciled', ACCOUNTING_IDS.accountant]
    ]);
    // The mark keeps the item as it stood.
    expect(world.accounting.marks[1]!.before).toMatchObject({ key, status: 'paid' });
    // Taking it back.
    const undone = await Effect.runPromise(
      reconcileReimbursementRouteProgram(
        context({ key }, { reconciled: false }),
        new Headers()
      ).pipe(Effect.provide(as))
    );
    expect(undone.item.status).toBe('paid');
  });

  it('reconciles only settled items, and finds no unknown item', async () => {
    const world = makeWorld();
    const as = world.as(ACCOUNTING_IDS.accountant, ACCOUNTANT);
    const unsettled = await Effect.runPromiseExit(
      reconcileReimbursementRouteProgram(
        context({ key: `family_refund:${FAILED_REFUND.id}` }, { reconciled: true }),
        new Headers()
      ).pipe(Effect.provide(as))
    );
    expect(failure(unsettled)?._tag).toBe('ObligationNotSettledError');
    const unknown = await Effect.runPromiseExit(
      getReimbursementRouteProgram(new Headers(), 'family_refund:nope').pipe(Effect.provide(as))
    );
    expect(failure(unknown)?._tag).toBe('ObligationNotFoundError');
    expect(world.accounting.marks).toHaveLength(0);
  });

  it('refuses notes without the permission, and while impersonating', async () => {
    const world = makeWorld();
    const key = `family_refund:${OK_REFUND.id}`;
    const readOnly = await Effect.runPromiseExit(
      addReimbursementNoteRouteProgram(context({ key }, { note: 'x' }), new Headers()).pipe(
        Effect.provide(world.as('reader', ['reimbursements:read']))
      )
    );
    expect(failure(readOnly)?._tag).toBe('ForbiddenError');
    const impersonated = await Effect.runPromiseExit(
      addReimbursementNoteRouteProgram(context({ key }, { note: 'x' }), new Headers()).pipe(
        Effect.provide(world.as(ACCOUNTING_IDS.accountant, ACCOUNTANT, { impersonatedBy: 'admin' }))
      )
    );
    expect(failure(impersonated)?._tag).toBe('AccountantImpersonatedWriteError');
    expect(world.accounting.marks).toHaveLength(0);
  });
});

describe('the accountant’s reports', () => {
  it('serves each report for the months asked', async () => {
    const world = makeWorld();
    const as = world.as(ACCOUNTING_IDS.accountant, ACCOUNTANT);
    const run = (report: string) =>
      Effect.runPromise(
        reportRouteProgram(
          new Headers(),
          { report, from: '2026-11-01', to: '2026-12-31' },
          NOW
        ).pipe(Effect.provide(as))
      );
    const liabilities = await run('liabilities');
    expect(liabilities.report).toBe('liabilities');
    const refunds = await run('refunds');
    expect(refunds.rows).toEqual([
      expect.objectContaining({ month: '2026-11', count: 1, refundedCents: 5041 }),
      expect.objectContaining({ month: '2026-12', count: 0 })
    ]);
    const absorbed = await run('absorbed');
    expect(absorbed.rows).toEqual([
      { month: '2026-11', cause: 'carry_write_off', count: 1, amountCents: 37 }
    ]);
    const fees = await run('fees');
    expect(fees).toMatchObject({ report: 'fees', gaps: ['2026-11', '2026-12'] });
  });

  it('refuses a range that ends before it starts', async () => {
    const world = makeWorld();
    const exit = await Effect.runPromiseExit(
      reportRouteProgram(new Headers(), {
        report: 'refunds',
        from: '2026-12-01',
        to: '2026-11-01'
      }).pipe(Effect.provide(world.as(ACCOUNTING_IDS.accountant, ACCOUNTANT)))
    );
    expect(failure(exit)?._tag).toBe('AccountantRangeError');
  });
});

describe('reconciliation', () => {
  it('runs on demand, lists the exceptions on both sides, and resolves one with a note', async () => {
    const world = makeWorld();
    const as = world.as(ACCOUNTING_IDS.accountant, ACCOUNTANT);
    const run = await Effect.runPromise(
      runReconciliationRouteProgram(
        context({}, { from: '2026-12-01', to: '2026-12-31' }),
        new Headers(),
        NOW
      ).pipe(Effect.provide(as))
    );
    expect(run.run).toMatchObject({ status: 'succeeded', imported: 3, matched: 2, unmatched: 1 });
    expect(world.reconciliation.state.runs[0]).toMatchObject({
      trigger: 'manual',
      requestedByUserId: ACCOUNTING_IDS.accountant
    });

    const view = await Effect.runPromise(
      reconciliationRouteProgram(new Headers(), { from: '2026-12-01', to: '2026-12-31' }).pipe(
        Effect.provide(as)
      )
    );
    expect(view.summary).toMatchObject({ imported: 3, matched: 2, unmatched: 2, oursUnmatched: 1 });
    expect(view.items.map((item) => [item.side, item.kind, item.reference, item.status])).toEqual([
      ['ours', 'payment', 'pi_lost', 'unmatched'],
      ['provider', 'charge', 'stray', 'unmatched']
    ]);

    const stray = view.items.find((item) => item.reference === 'stray')!;
    const resolved = await Effect.runPromise(
      resolveReconciliationItemRouteProgram(
        context({ key: stray.key }, { note: 'test charge from the dashboard' }),
        new Headers()
      ).pipe(Effect.provide(as))
    );
    expect(resolved.resolution).toMatchObject({ action: 'resolved' });
    const after = await Effect.runPromise(
      reconciliationRouteProgram(new Headers(), { from: '2026-12-01', to: '2026-12-31' }).pipe(
        Effect.provide(as)
      )
    );
    expect(after.items.find((item) => item.key === stray.key)).toMatchObject({
      status: 'resolved',
      resolution: { note: 'test charge from the dashboard', by: ACCOUNTING_IDS.accountant }
    });
    expect(world.accounting.marks.map((row) => [row.entity, row.action])).toEqual([
      ['reconciliation_item', 'resolved']
    ]);

    const matched =
      view.items.length === 2
        ? world.reconciliation.state.transactions.find((row) => row.reference === 'known')!
        : null;
    const refused = await Effect.runPromiseExit(
      resolveReconciliationItemRouteProgram(
        context({ key: `txn:${matched!.id}` }, { note: 'x' }),
        new Headers()
      ).pipe(Effect.provide(as))
    );
    expect(failure(refused)?._tag).toBe('ReconciliationItemMatchedError');

    const text = await Effect.runPromise(
      reconciliationCsvRouteProgram(new Headers(), { from: '2026-12-01', to: '2026-12-31' }).pipe(
        Effect.provide(as)
      )
    );
    expect(text.text.split('\n')[0]).toBe(
      'key,side,kind,reference,amount_cad,fee_cad,occurred_at,status,matched_to,matched_id,account,payout,note,resolution_note'
    );
    expect(text.text.trim().split('\n')).toHaveLength(5);
  });

  it('refuses a run to whoever lacks the run permission, and a range too long', async () => {
    const world = makeWorld();
    const readOnly = await Effect.runPromiseExit(
      runReconciliationRouteProgram(
        context({}, { from: '2026-12-01', to: '2026-12-31' }),
        new Headers(),
        NOW
      ).pipe(Effect.provide(world.as('reader', ['reconciliation:read'])))
    );
    expect(failure(readOnly)?._tag).toBe('ForbiddenError');
    const tooLong = await Effect.runPromiseExit(
      runReconciliationRouteProgram(
        context({}, { from: '2025-01-01', to: '2026-12-31' }),
        new Headers(),
        NOW
      ).pipe(Effect.provide(world.as(ACCOUNTING_IDS.admin, ADMIN)))
    );
    expect(failure(tooLong)?._tag).toBe('AccountantRangeError');
    const future = await Effect.runPromiseExit(
      runReconciliationRouteProgram(
        context({}, { from: '2026-12-16', to: '2026-12-20' }),
        new Headers(),
        NOW
      ).pipe(Effect.provide(world.as(ACCOUNTING_IDS.admin, ADMIN)))
    );
    expect(failure(future)?._tag).toBe('ReconciliationFuturePeriodError');
    expect(world.reconciliation.state.runs).toHaveLength(0);
  });

  it('answers busy while another run is in progress', async () => {
    const world = makeWorld();
    await Effect.runPromise(
      runReconciliationRouteProgram(
        context({}, { from: '2026-12-01', to: '2026-12-31' }),
        new Headers(),
        NOW
      ).pipe(Effect.provide(world.as(ACCOUNTING_IDS.admin, ADMIN)))
    );
    world.reconciliation.state.runs[0]!.status = 'running';
    const exit = await Effect.runPromiseExit(
      runReconciliationRouteProgram(
        context({}, { from: '2026-12-01', to: '2026-12-31' }),
        new Headers(),
        NOW
      ).pipe(Effect.provide(world.as(ACCOUNTING_IDS.admin, ADMIN)))
    );
    expect(failure(exit)?._tag).toBe('ReconciliationBusyError');
  });
});
