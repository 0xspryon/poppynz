import { SqlError } from '@effect/sql/SqlError';
import {
  makeSeededTaxConfigRepo,
  makeInMemoryTaxReportRepo,
  makeSessionRepoTest,
  makeTaxReportRepoTest,
  makeUserRepoTest,
  TaxConfigRepo,
  DBNotFoundError,
  type PaymentTaxLine,
  type Session,
  type TaxCollectedSource,
  type User
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  getTaxAccessRouteProgram,
  getTaxConfigRouteProgram,
  isPlaceholderNumber,
  listTaxAuditRouteProgram,
  supersedeTaxRateRouteProgram,
  supersedeTaxRegistrationRouteProgram,
  supersedeTaxTreatmentRouteProgram,
  taxCollectedReportRouteProgram
} from './tax.handler';
import { aggregateTaxCollected, periodOf, taxCollectedCsv } from './tax-report';
import { sessionRefundTaxSource } from '@repo/db';

const NOW = new Date('2026-10-24T15:00:00.000Z'); // Sat 24 Oct 2026, Toronto

const accountant = {
  id: 'accountant-1',
  name: 'Ann Count',
  email: 'accountant@example.test',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  isAnonymous: false,
  role: 'accountant',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null
} as User;

const session = { id: 'session-1', userId: accountant.id } as Session;

type Grant = 'tax:read' | 'tax:write' | 'taxReport:read';
const ALL: ReadonlyArray<Grant> = ['tax:read', 'tax:write', 'taxReport:read'];

const makeLayer = (
  options: {
    grants?: ReadonlyArray<Grant>;
    taxRepo?: ReturnType<typeof makeSeededTaxConfigRepo>;
    sources?: Array<TaxCollectedSource>;
    reportFails?: boolean;
    /** The admin impersonating the accountant, when the session is one. */
    impersonatedBy?: string;
  } = {}
) => {
  const grants = new Set(options.grants ?? ALL);
  const taxRepo = options.taxRepo ?? makeSeededTaxConfigRepo();
  const layer = Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () =>
        Effect.succeed({ user: { id: accountant.id }, session: { id: session.id } }),
      userHasPermission: (_headers, permissions) =>
        Effect.succeed(
          Object.entries(permissions).every(([resource, actions]) =>
            (actions as Array<string>).every((action) =>
              grants.has(`${resource}:${action}` as Grant)
            )
          )
        )
    }),
    makeUserRepoTest({
      findById: (id) =>
        id === accountant.id
          ? Effect.succeed(accountant)
          : Effect.fail(new DBNotFoundError({ entity: 'user', value: id })),
      findByEmail: () => Effect.succeed(accountant)
    }),
    makeSessionRepoTest({
      findById: () =>
        Effect.succeed(
          options.impersonatedBy
            ? ({ ...session, impersonatedBy: options.impersonatedBy } as Session)
            : session
        )
    }),
    taxRepo.layer,
    options.reportFails
      ? makeTaxReportRepoTest({
          listCollected: () => Effect.fail(new SqlError({ cause: 'down' }))
        })
      : makeInMemoryTaxReportRepo(options.sources ?? [])
  );
  return { layer, taxRepo };
};

type TestLayer = ReturnType<typeof makeLayer>['layer'];

const body = (value: unknown) =>
  ({ req: { json: () => Promise.resolve(value) } }) as unknown as HonoContext<HonoEnv>;

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const value = Cause.failureOption(exit.cause);
  return Option.isSome(value) ? (value.value as { _tag: string; code?: string }) : null;
};

const ontarioRate = {
  jurisdictionCode: 'ON',
  component: 'hst',
  rateMillipercent: 13500,
  effectiveFrom: '2027-01-01',
  reason: 'Budget 2026: HST to 13.5%'
};

describe('GET /tax/access', () => {
  it('reports what the signed-in user may do', async () => {
    const { layer } = makeLayer();
    expect(
      await Effect.runPromise(getTaxAccessRouteProgram(new Headers()).pipe(Effect.provide(layer)))
    ).toEqual({
      canRead: true,
      canWrite: true,
      canReport: true
    });
  });

  it('answers all false for a user without the tax permissions', async () => {
    const { layer } = makeLayer({ grants: [] });
    expect(
      await Effect.runPromise(getTaxAccessRouteProgram(new Headers()).pipe(Effect.provide(layer)))
    ).toEqual({
      canRead: false,
      canWrite: false,
      canReport: false
    });
  });
});

describe('GET /tax/config', () => {
  it('lists the configuration with what is in force today', async () => {
    const { layer } = makeLayer();
    const result = await Effect.runPromise(
      getTaxConfigRouteProgram(new Headers(), NOW).pipe(Effect.provide(layer))
    );
    expect(result.today).toBe('2026-10-24');
    expect(result.jurisdictions.map((row) => row.code)).toContain('QC');
    expect(result.supplyTypes.map((row) => row.code)).toContain('family_service_fee');
    const ns = result.rates.filter((row) => row.jurisdictionCode === 'NS');
    expect(ns.map((row) => [row.rateMillipercent, row.standing])).toEqual([
      [15000, 'ended'],
      [14000, 'in_force']
    ]);
    expect(result.registrations.every((row) => row.isPlaceholder)).toBe(true);
  });

  it('is denied without tax read', async () => {
    const { layer } = makeLayer({ grants: ['taxReport:read'] });
    const exit = await Effect.runPromiseExit(
      getTaxConfigRouteProgram(new Headers(), NOW).pipe(Effect.provide(layer))
    );
    expect(failure(exit)?._tag).toBe('ForbiddenError');
  });

  it('maps a database failure to the repo error', async () => {
    const { layer } = makeLayer();
    const broken = Layer.succeed(TaxConfigRepo, {
      ...Effect.runSync(TaxConfigRepo.pipe(Effect.provide(makeSeededTaxConfigRepo().layer))),
      listRates: () => Effect.fail(new SqlError({ cause: 'down' }))
    });
    const exit = await Effect.runPromiseExit(
      getTaxConfigRouteProgram(new Headers(), NOW).pipe(Effect.provide(Layer.merge(layer, broken)))
    );
    expect(failure(exit)?._tag).toBe('TaxRepoError');
  });
});

describe('POST /tax/rates', () => {
  const post = (layer: TestLayer, input: unknown) =>
    Effect.runPromiseExit(
      supersedeTaxRateRouteProgram(body(input), new Headers(), NOW).pipe(Effect.provide(layer))
    );

  it('supersedes the rate in force from the new date, with an audit row', async () => {
    const { layer, taxRepo } = makeLayer();
    const exit = await post(layer, ontarioRate);
    expect(Exit.isSuccess(exit)).toBe(true);
    const on = taxRepo.state.rates.filter(
      (row) => row.jurisdictionCode === 'ON' && row.component === 'hst'
    );
    // History is closed, never rewritten: 13% ends where 13.5% starts.
    expect(on.map((row) => [row.rateMillipercent, row.effectiveFrom, row.effectiveTo])).toEqual([
      [13000, '2010-07-01', '2027-01-01'],
      [13500, '2027-01-01', null]
    ]);
    expect(taxRepo.state.audit.map((row) => [row.action, row.actorUserId, row.reason])).toEqual([
      ['close', 'accountant-1', 'Budget 2026: HST to 13.5%'],
      ['create', 'accountant-1', 'Budget 2026: HST to 13.5%']
    ]);
  });

  it('requires a reason', async () => {
    const { layer, taxRepo } = makeLayer();
    const exit = await post(layer, { ...ontarioRate, reason: '  ' });
    expect(failure(exit)?._tag).toBe('RequestValidationError');
    expect(taxRepo.state.audit).toEqual([]);
  });

  it('refuses a negative rate', async () => {
    const { layer } = makeLayer();
    expect(failure(await post(layer, { ...ontarioRate, rateMillipercent: -1 }))?._tag).toBe(
      'RequestValidationError'
    );
  });

  it('refuses a past start date unless it is explicitly confirmed', async () => {
    const { layer } = makeLayer();
    const past = { ...ontarioRate, effectiveFrom: '2026-10-01' };
    expect(failure(await post(layer, past))?._tag).toBe('TaxPastEffectiveDateError');
    const confirmed = await post(layer, { ...past, confirmPastEffectiveDate: true });
    expect(Exit.isSuccess(confirmed)).toBe(true);
  });

  it('refuses an end that is not after the start', async () => {
    const { layer } = makeLayer();
    const exit = await post(layer, { ...ontarioRate, effectiveTo: '2026-12-31' });
    expect(failure(exit)?._tag).toBe('TaxEffectiveRangeError');
  });

  it('refuses an overlap with a later value as a typed error', async () => {
    const { layer } = makeLayer();
    await post(layer, ontarioRate);
    // 2026-12-01 would rewrite the value starting 2027-01-01.
    const exit = await post(layer, { ...ontarioRate, effectiveFrom: '2026-12-01' });
    expect(failure(exit)?._tag).toBe('TaxConfigOverlapError');
  });

  it('refuses an unknown jurisdiction', async () => {
    const { layer } = makeLayer();
    const exit = await post(layer, { ...ontarioRate, jurisdictionCode: 'ZZ' });
    expect(failure(exit)?._tag).toBe('TaxUnknownJurisdictionError');
  });

  it('is denied without tax write (read-only access)', async () => {
    const { layer, taxRepo } = makeLayer({ grants: ['tax:read', 'taxReport:read'] });
    expect(failure(await post(layer, ontarioRate))?._tag).toBe('ForbiddenError');
    expect(taxRepo.state.audit).toEqual([]);
  });
});

describe('POST /tax/treatments', () => {
  const treatment = {
    supplyTypeCode: 'family_service_fee',
    treatment: 'taxable',
    components: ['gst', 'hst', 'qst', 'pst'],
    placeOfSupply: 'contract_location',
    effectiveFrom: '2027-01-01',
    reason: 'PST now applies to the service fee'
  };
  const post = (layer: TestLayer, input: unknown) =>
    Effect.runPromiseExit(
      supersedeTaxTreatmentRouteProgram(body(input), new Headers(), NOW).pipe(Effect.provide(layer))
    );

  it('supersedes the treatment in force', async () => {
    const { layer, taxRepo } = makeLayer();
    const exit = await post(layer, treatment);
    expect(Exit.isSuccess(exit)).toBe(true);
    const fee = taxRepo.state.treatments.filter(
      (row) => row.supplyTypeCode === 'family_service_fee'
    );
    expect(fee.map((row) => [row.effectiveTo, row.components])).toEqual([
      ['2027-01-01', ['gst', 'hst', 'qst']],
      [null, ['gst', 'hst', 'qst', 'pst']]
    ]);
  });

  it('drops components from a supply that is not taxable', async () => {
    const { layer, taxRepo } = makeLayer();
    await post(layer, { ...treatment, treatment: 'exempt' });
    expect(taxRepo.state.treatments.at(-1)?.components).toEqual([]);
  });

  it('is denied without tax write', async () => {
    const { layer } = makeLayer({ grants: ['tax:read'] });
    expect(failure(await post(layer, treatment))?._tag).toBe('ForbiddenError');
  });
});

describe('POST /tax/registrations', () => {
  const registration = {
    jurisdictionCode: 'CA',
    program: 'gst_hst',
    components: ['gst', 'hst'],
    registrationNumber: '123456789RT0001',
    registered: true,
    effectiveFrom: '2026-11-01',
    reason: 'Real GST/HST number from CRA'
  };
  const post = (layer: TestLayer, input: unknown) =>
    Effect.runPromiseExit(
      supersedeTaxRegistrationRouteProgram(body(input), new Headers(), NOW).pipe(
        Effect.provide(layer)
      )
    );

  it('records the real number, no longer a placeholder', async () => {
    const { layer } = makeLayer();
    const exit = await post(layer, registration);
    expect(exit).toEqual(
      Exit.succeed(
        expect.objectContaining({
          registration: expect.objectContaining({
            registrationNumber: '123456789RT0001',
            isPlaceholder: false,
            standing: 'scheduled'
          }),
          warnings: []
        })
      )
    );
  });

  it('flags a placeholder number', async () => {
    const { layer } = makeLayer();
    const exit = await post(layer, {
      ...registration,
      registrationNumber: 'PLACEHOLDER-000000000RT0001'
    });
    expect(Exit.isSuccess(exit) && exit.value.registration.isPlaceholder).toBe(true);
    expect(Exit.isSuccess(exit) && exit.value.warnings).toEqual(['placeholder_number']);
    expect(isPlaceholderNumber(null)).toBe(true);
    expect(isPlaceholderNumber('123456789RT0001')).toBe(false);
  });

  it('can switch a registration off', async () => {
    const { layer, taxRepo } = makeLayer();
    await post(layer, {
      ...registration,
      jurisdictionCode: 'QC',
      program: 'qst',
      components: ['qst'],
      registrationNumber: null,
      registered: false,
      reason: 'Deregistered from QST'
    });
    const qst = taxRepo.state.registrations.filter((row) => row.program === 'qst');
    expect(qst.map((row) => [row.registered, row.effectiveTo])).toEqual([
      [true, '2026-11-01'],
      [false, null]
    ]);
  });

  it('is denied without tax write', async () => {
    const { layer } = makeLayer({ grants: ['tax:read'] });
    expect(failure(await post(layer, registration))?._tag).toBe('ForbiddenError');
  });
});

describe('impersonated sessions (R10)', () => {
  const writes = [
    ['rate', (c: HonoContext<HonoEnv>) => supersedeTaxRateRouteProgram(c, new Headers(), NOW)],
    [
      'treatment',
      (c: HonoContext<HonoEnv>) => supersedeTaxTreatmentRouteProgram(c, new Headers(), NOW)
    ],
    [
      'registration',
      (c: HonoContext<HonoEnv>) => supersedeTaxRegistrationRouteProgram(c, new Headers(), NOW)
    ]
  ] as const;
  const inputs = {
    rate: ontarioRate,
    treatment: {
      supplyTypeCode: 'family_service_fee',
      treatment: 'exempt',
      components: [],
      placeOfSupply: 'contract_location',
      effectiveFrom: '2027-01-01',
      reason: 'test'
    },
    registration: {
      jurisdictionCode: 'CA',
      program: 'gst_hst',
      components: ['gst', 'hst'],
      registrationNumber: '123456789RT0001',
      registered: true,
      effectiveFrom: '2027-01-01',
      reason: 'test'
    }
  };

  for (const [name, program] of writes) {
    it(`refuses a ${name} write from an admin impersonating the accountant`, async () => {
      const { layer, taxRepo } = makeLayer({ impersonatedBy: 'admin-1' });
      const exit = await Effect.runPromiseExit(
        program(body(inputs[name])).pipe(Effect.provide(layer))
      );
      expect(failure(exit)?._tag).toBe('TaxImpersonatedWriteError');
      // Nothing written, nothing audited under the accountant's name.
      expect(taxRepo.state.audit).toEqual([]);
    });
  }

  it('still lets an impersonating admin read the configuration', async () => {
    const { layer } = makeLayer({ impersonatedBy: 'admin-1' });
    const exit = await Effect.runPromiseExit(
      getTaxConfigRouteProgram(new Headers(), NOW).pipe(Effect.provide(layer))
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

describe('GET /tax/audit', () => {
  it('lists changes newest first with who made them and why', async () => {
    const { layer } = makeLayer();
    await Effect.runPromise(
      supersedeTaxRateRouteProgram(body(ontarioRate), new Headers(), NOW).pipe(
        Effect.provide(layer)
      )
    );
    const result = await Effect.runPromise(
      listTaxAuditRouteProgram(new Headers(), { entity: 'tax_rate' }).pipe(Effect.provide(layer))
    );
    expect(result.entries.map((entry) => [entry.action, entry.actor?.name, entry.reason])).toEqual([
      ['create', 'Ann Count', 'Budget 2026: HST to 13.5%'],
      ['close', 'Ann Count', 'Budget 2026: HST to 13.5%']
    ]);
  });

  it('is denied without tax read', async () => {
    const { layer } = makeLayer({ grants: [] });
    const exit = await Effect.runPromiseExit(
      listTaxAuditRouteProgram(new Headers(), {}).pipe(Effect.provide(layer))
    );
    expect(failure(exit)?._tag).toBe('ForbiddenError');
  });
});

const line = (overrides: Partial<PaymentTaxLine>): PaymentTaxLine => ({
  supplyType: 'family_service_fee',
  jurisdiction: 'ON',
  component: 'hst',
  rateMillipercent: 13000,
  baseCents: 625,
  taxCents: 81,
  label: 'HST (ON) 13%',
  registrationNumber: null,
  ...overrides
});

const sources: Array<TaxCollectedSource> = [
  {
    source: 'contract_cycle',
    id: 'cycle-1',
    capturedAt: new Date('2026-11-02T12:00:00.000Z'),
    taxLines: [
      line({}),
      line({
        supplyType: 'provider_commission',
        jurisdiction: 'MB',
        component: 'gst',
        rateMillipercent: 5000,
        baseCents: 1875,
        taxCents: 94,
        label: 'GST (MB) 5%'
      })
    ]
  },
  {
    source: 'contract_cycle',
    id: 'cycle-2',
    // 22:00 on 30 Nov in Toronto: November, although December in UTC.
    capturedAt: new Date('2026-12-01T03:00:00.000Z'),
    taxLines: [line({ baseCents: 313, taxCents: 41 })]
  },
  {
    source: 'payment',
    id: 'payment-1',
    capturedAt: new Date('2026-12-10T15:00:00.000Z'),
    taxLines: [
      line({ supplyType: 'credibled_check', baseCents: 5500, taxCents: 715 }),
      line({ supplyType: 'credibled_admin_fee', baseCents: 500, taxCents: 65 })
    ]
  }
];

describe('tax collected report', () => {
  it('sums the frozen lines by period, jurisdiction, component and supply type', async () => {
    const { layer } = makeLayer({ sources });
    const result = await Effect.runPromise(
      taxCollectedReportRouteProgram(new Headers(), {
        from: '2026-11-01',
        to: '2026-12-31'
      }).pipe(Effect.provide(layer))
    );
    expect(
      result.rows.map((row) => [
        row.period,
        row.jurisdiction,
        row.component,
        row.supplyType,
        row.baseCents,
        row.taxCents,
        row.lines
      ])
    ).toEqual([
      ['2026-11', 'MB', 'gst', 'provider_commission', 1875, 94, 1],
      ['2026-11', 'ON', 'hst', 'family_service_fee', 938, 122, 2],
      ['2026-12', 'ON', 'hst', 'credibled_admin_fee', 500, 65, 1],
      ['2026-12', 'ON', 'hst', 'credibled_check', 5500, 715, 1]
    ]);
    expect(result.totalTaxCents).toBe(996);
  });

  it('groups by quarter and keeps only charges captured in the range', async () => {
    const { layer } = makeLayer({ sources });
    const result = await Effect.runPromise(
      taxCollectedReportRouteProgram(new Headers(), {
        from: '2026-11-01',
        to: '2026-11-30',
        period: 'quarter'
      }).pipe(Effect.provide(layer))
    );
    expect(result.rows.map((row) => [row.period, row.taxCents])).toEqual([
      ['2026-Q4', 94],
      ['2026-Q4', 122]
    ]);
  });

  it('exports CSV', () => {
    const csv = taxCollectedCsv(aggregateTaxCollected(sources, 'month'));
    expect(csv.split('\n').slice(0, 3)).toEqual([
      'period,jurisdiction,component,supply_type,rate_percent,base_cad,tax_cad,lines',
      '2026-11,MB,GST,provider_commission,5,18.75,0.94,1',
      '2026-11,ON,HST,family_service_fee,13,9.38,1.22,2'
    ]);
    expect(periodOf(new Date('2026-12-01T03:00:00.000Z'), 'month')).toBe('2026-11');
  });

  it('subtracts a session refund’s returned tax in the refund’s period (Tier 3 step 2)', () => {
    const hst = {
      supplyType: 'family_service_fee',
      jurisdiction: 'ON',
      component: 'hst',
      rateMillipercent: 13000,
      label: 'HST (ON) 13%',
      registrationNumber: null
    };
    const gst = {
      ...hst,
      supplyType: 'provider_commission',
      jurisdiction: 'MB',
      component: 'gst',
      rateMillipercent: 5000,
      label: 'GST (MB) 5%'
    };
    const refund = sessionRefundTaxSource({
      id: 'refund-1',
      // Charged in November, refunded on 2 December (Toronto time).
      refundedAt: new Date('2026-12-02T15:00:00.000Z'),
      careTaxLines: [],
      feeTaxLines: [{ ...hst, baseCents: 312, taxCents: 40 }],
      commissionTaxLines: [{ ...gst, baseCents: 937, taxCents: 47 }]
    });
    const rows = aggregateTaxCollected([...sources, refund], 'month').map((row) => [
      row.period,
      row.jurisdiction,
      row.supplyType,
      row.baseCents,
      row.taxCents
    ]);
    // November is untouched; December carries the negative lines.
    expect(rows).toContainEqual(['2026-11', 'ON', 'family_service_fee', 938, 122]);
    expect(rows).toContainEqual(['2026-12', 'ON', 'family_service_fee', -312, -40]);
    expect(rows).toContainEqual(['2026-12', 'MB', 'provider_commission', -937, -47]);
  });

  it('refuses an end before the start', async () => {
    const { layer } = makeLayer({ sources });
    const exit = await Effect.runPromiseExit(
      taxCollectedReportRouteProgram(new Headers(), { from: '2026-12-01', to: '2026-11-01' }).pipe(
        Effect.provide(layer)
      )
    );
    expect(failure(exit)?._tag).toBe('TaxReportRangeError');
  });

  it('refuses a malformed date', async () => {
    const { layer } = makeLayer({ sources });
    const exit = await Effect.runPromiseExit(
      taxCollectedReportRouteProgram(new Headers(), { from: 'soon', to: '2026-11-01' }).pipe(
        Effect.provide(layer)
      )
    );
    expect(failure(exit)?._tag).toBe('RequestValidationError');
  });

  it('is denied without taxReport read, even with tax read and write', async () => {
    const { layer } = makeLayer({ grants: ['tax:read', 'tax:write'], sources });
    const exit = await Effect.runPromiseExit(
      taxCollectedReportRouteProgram(new Headers(), { from: '2026-11-01', to: '2026-11-30' }).pipe(
        Effect.provide(layer)
      )
    );
    expect(failure(exit)?._tag).toBe('ForbiddenError');
  });

  it('maps a database failure to the repo error', async () => {
    const { layer } = makeLayer({ reportFails: true });
    const exit = await Effect.runPromiseExit(
      taxCollectedReportRouteProgram(new Headers(), { from: '2026-11-01', to: '2026-11-30' }).pipe(
        Effect.provide(layer)
      )
    );
    expect(failure(exit)?._tag).toBe('TaxRepoError');
  });
});
