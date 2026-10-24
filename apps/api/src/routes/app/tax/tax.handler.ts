import type { SqlError } from '@effect/sql/SqlError';
import { instantAt, todayIn } from '@repo/calendar';
import { inForce } from '@repo/billing/pricing';
import {
  TaxConfigRepo,
  TaxReportRepo,
  UserRepo,
  type TaxConfigAudit,
  type TaxConfigEntity,
  type TaxRate,
  type TaxRegistration,
  type TaxSupplyTreatment
} from '@repo/db';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  AuthService,
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import {
  aggregateTaxCollected,
  TAX_REPORT_ZONE,
  taxCollectedCsv,
  type TaxReportPeriod
} from './tax-report';
import {
  taxJsonError,
  validateTaxRateWrite,
  validateTaxRegistrationWrite,
  validateTaxReportQuery,
  validateTaxTreatmentWrite
} from './tax.validator';

/**
 * The accountant tax portal (piece 3 spec §3a): the tax configuration —
 * effective-dated rates, supply-type treatments, Poppynz's registrations —
 * its audit trail, and the tax-collected report.
 *
 * Access is by permission only (`tax`, `taxReport`), granted to the
 * accountant and admin roles. Every write supersedes: the row in force is
 * closed on the new row's start and the new row inserted, with an audit row,
 * in one transaction (`TaxConfigRepo`). A change applies to quotes made from
 * then on; charges already made keep the tax lines frozen on them.
 */

/** The tax configuration's calendar (dates are Toronto dates). */
const TAX_ZONE = TAX_REPORT_ZONE;

export class TaxRepoError extends Data.TaggedError('TaxRepoError')<{ cause: SqlError }> {}

/** A start date already past needs `confirmPastEffectiveDate: true`. */
export class TaxPastEffectiveDateError extends Data.TaggedError('TaxPastEffectiveDateError')<{
  effectiveFrom: string;
  today: string;
}> {}

/** The end is not after the start. */
export class TaxEffectiveRangeError extends Data.TaggedError('TaxEffectiveRangeError')<{
  effectiveFrom: string;
  effectiveTo: string;
}> {}

export class TaxUnknownJurisdictionError extends Data.TaggedError('TaxUnknownJurisdictionError')<{
  jurisdictionCode: string;
}> {}

/** `to` is not after `from`, or the range is longer than the report allows. */
export class TaxReportRangeError extends Data.TaggedError('TaxReportRangeError')<{}> {}

const mapTaxRepoError = <A, E, R>(
  effect: Effect.Effect<A, E | SqlError, R>
): Effect.Effect<A, Exclude<E, SqlError> | TaxRepoError, R> =>
  effect.pipe(
    Effect.catchIf(
      (error): error is SqlError => (error as { _tag?: string })?._tag === 'SqlError',
      (cause) => Effect.fail(new TaxRepoError({ cause }))
    )
  ) as Effect.Effect<A, Exclude<E, SqlError> | TaxRepoError, R>;

// ---------------------------------------------------------------------------
// Presentation

type Dated = { effectiveFrom: string; effectiveTo: string | null };

/** In force today, starting later, or ended — for the portal's tables. */
const standing = (row: Dated, today: string) =>
  inForce(row, today)
    ? ('in_force' as const)
    : row.effectiveFrom > today
      ? ('scheduled' as const)
      : ('ended' as const);

const toRate = (row: TaxRate, today: string) => ({
  id: row.id,
  jurisdictionCode: row.jurisdictionCode,
  component: row.component,
  rateMillipercent: row.rateMillipercent,
  effectiveFrom: row.effectiveFrom,
  effectiveTo: row.effectiveTo,
  standing: standing(row, today)
});

const toTreatment = (row: TaxSupplyTreatment, today: string) => ({
  id: row.id,
  supplyTypeCode: row.supplyTypeCode,
  treatment: row.treatment,
  components: row.components,
  placeOfSupply: row.placeOfSupply,
  effectiveFrom: row.effectiveFrom,
  effectiveTo: row.effectiveTo,
  standing: standing(row, today)
});

const toRegistration = (row: TaxRegistration, today: string) => ({
  id: row.id,
  jurisdictionCode: row.jurisdictionCode,
  program: row.program,
  components: row.components,
  registrationNumber: row.registrationNumber,
  registered: row.registered,
  isPlaceholder: row.isPlaceholder,
  effectiveFrom: row.effectiveFrom,
  effectiveTo: row.effectiveTo,
  standing: standing(row, today)
});

/** A number nobody may print on a receipt: missing, or a placeholder. */
export const isPlaceholderNumber = (registrationNumber: string | null) =>
  registrationNumber === null ||
  registrationNumber.trim() === '' ||
  /placeholder/i.test(registrationNumber);

// ---------------------------------------------------------------------------
// Shared write checks

/** Dates are checked before anything is written: an end after the start, and
 * a start already past only with an explicit confirmation — it changes what
 * was in force on days that have gone (frozen charges never change). */
export const checkEffectiveDates = (
  input: { effectiveFrom: string; effectiveTo?: string | null; confirmPastEffectiveDate?: boolean },
  today: string
) =>
  Effect.gen(function* () {
    if (input.effectiveTo != null && input.effectiveTo <= input.effectiveFrom) {
      return yield* Effect.fail(
        new TaxEffectiveRangeError({
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo
        })
      );
    }
    if (input.effectiveFrom < today && input.confirmPastEffectiveDate !== true) {
      return yield* Effect.fail(
        new TaxPastEffectiveDateError({ effectiveFrom: input.effectiveFrom, today })
      );
    }
  });

const requireJurisdiction = (code: string) =>
  Effect.gen(function* () {
    const repo = yield* TaxConfigRepo;
    const known = yield* repo.listJurisdictions().pipe((errors) => mapTaxRepoError(errors));
    if (!known.some((row) => row.code === code)) {
      return yield* Effect.fail(new TaxUnknownJurisdictionError({ jurisdictionCode: code }));
    }
  });

const writeAccess = (headers: Headers) =>
  authenticate(headers).pipe(
    Effect.flatMap((authenticated) =>
      requirePermissions(headers, { tax: ['write'] })(authenticated)
    )
  );

// ---------------------------------------------------------------------------
// Programs

/** What the signed-in user may do in the tax portal — drives the nav for
 * admins and accountants alike. Never a role check. */
export const getTaxAccessRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    yield* authenticate(headers);
    const authService = yield* AuthService;
    const [canRead, canWrite, canReport] = yield* Effect.all([
      authService.userHasPermission(headers, { tax: ['read'] }),
      authService.userHasPermission(headers, { tax: ['write'] }),
      authService.userHasPermission(headers, { taxReport: ['read'] })
    ]);
    return { canRead, canWrite, canReport };
  });

/** The whole configuration with its history (closed and scheduled rows). */
export const getTaxConfigRouteProgram = (headers: Headers, now: Date = new Date()) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { tax: ['read'] })(authenticated);
    const repo = yield* TaxConfigRepo;
    const today = todayIn(TAX_ZONE, now);
    const config = yield* Effect.all({
      jurisdictions: repo.listJurisdictions(),
      supplyTypes: repo.listSupplyTypes(),
      rates: repo.listRates(),
      treatments: repo.listSupplyTreatments(),
      registrations: repo.listRegistrations()
    }).pipe((errors) => mapTaxRepoError(errors));
    return {
      today,
      jurisdictions: config.jurisdictions.map(({ code, name, kind }) => ({ code, name, kind })),
      supplyTypes: config.supplyTypes.map(({ code, name }) => ({ code, name })),
      rates: config.rates.map((row) => toRate(row, today)),
      treatments: config.treatments.map((row) => toTreatment(row, today)),
      registrations: config.registrations.map((row) => toRegistration(row, today))
    };
  });

export const supersedeTaxRateRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, taxJsonError);
    const input = yield* validateTaxRateWrite(rawBody);
    const userAndSession = yield* writeAccess(headers);
    const today = todayIn(TAX_ZONE, now);
    yield* checkEffectiveDates(input, today);
    yield* requireJurisdiction(input.jurisdictionCode);
    const repo = yield* TaxConfigRepo;
    const row = yield* repo
      .supersedeRate(
        {
          jurisdictionCode: input.jurisdictionCode,
          component: input.component,
          rateMillipercent: input.rateMillipercent,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null
        },
        { actorUserId: userAndSession.user.id, reason: input.reason }
      )
      .pipe((errors) => mapTaxRepoError(errors));
    return { rate: toRate(row, today) };
  });

export const supersedeTaxTreatmentRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, taxJsonError);
    const input = yield* validateTaxTreatmentWrite(rawBody);
    const userAndSession = yield* writeAccess(headers);
    const today = todayIn(TAX_ZONE, now);
    yield* checkEffectiveDates(input, today);
    const repo = yield* TaxConfigRepo;
    const row = yield* repo
      .supersedeSupplyTreatment(
        {
          supplyTypeCode: input.supplyTypeCode,
          treatment: input.treatment,
          // Only a taxable supply lists components.
          components: input.treatment === 'taxable' ? [...new Set(input.components)] : [],
          placeOfSupply: input.placeOfSupply,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null
        },
        { actorUserId: userAndSession.user.id, reason: input.reason }
      )
      .pipe((errors) => mapTaxRepoError(errors));
    return { treatment: toTreatment(row, today) };
  });

export const supersedeTaxRegistrationRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, taxJsonError);
    const input = yield* validateTaxRegistrationWrite(rawBody);
    const userAndSession = yield* writeAccess(headers);
    const today = todayIn(TAX_ZONE, now);
    yield* checkEffectiveDates(input, today);
    yield* requireJurisdiction(input.jurisdictionCode);
    const number = input.registrationNumber?.trim() ? input.registrationNumber.trim() : null;
    // A placeholder is flagged, never printed on a receipt ("pending").
    const isPlaceholder = isPlaceholderNumber(number);
    const repo = yield* TaxConfigRepo;
    const row = yield* repo
      .supersedeRegistration(
        {
          jurisdictionCode: input.jurisdictionCode,
          program: input.program,
          components: [...new Set(input.components)],
          registrationNumber: number,
          registered: input.registered,
          isPlaceholder,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null
        },
        { actorUserId: userAndSession.user.id, reason: input.reason }
      )
      .pipe((errors) => mapTaxRepoError(errors));
    return {
      registration: toRegistration(row, today),
      warnings: isPlaceholder && input.registered ? (['placeholder_number'] as const) : []
    };
  });

const AUDIT_ENTITIES: ReadonlyArray<TaxConfigEntity> = [
  'tax_rate',
  'tax_supply_treatment',
  'tax_registration'
];

const toAuditEntry = (
  row: TaxConfigAudit,
  actors: Map<string, { name: string; email: string } | null>
) => ({
  id: row.id,
  entity: row.entity,
  recordId: row.recordId,
  action: row.action,
  actor: row.actorUserId ? { id: row.actorUserId, ...(actors.get(row.actorUserId) ?? {}) } : null,
  reason: row.reason,
  before: row.before,
  after: row.after,
  createdAt: row.createdAt.toISOString()
});

export const listTaxAuditRouteProgram = (
  headers: Headers,
  query: { entity?: string; limit?: string }
) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { tax: ['read'] })(authenticated);
    const entity = AUDIT_ENTITIES.find((value) => value === query.entity);
    const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 500);
    const repo = yield* TaxConfigRepo;
    const rows = yield* repo
      .listAudit({ ...(entity ? { entity } : {}), limit })
      .pipe((errors) => mapTaxRepoError(errors));
    const users = yield* UserRepo;
    const actors = new Map<string, { name: string; email: string } | null>();
    for (const id of new Set(rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])))) {
      const user = yield* users.findById(id).pipe(Effect.orElseSucceed(() => null));
      actors.set(id, user ? { name: user.name, email: user.email } : null);
    }
    return { entries: rows.map((row) => toAuditEntry(row, actors)) };
  });

const MAX_REPORT_DAYS = 3 * 366;

/** Tax collected, by period × jurisdiction × component × supply type, from
 * the lines frozen on what was charged in `[from, to]` (Toronto dates). */
export const taxCollectedReportRouteProgram = (
  headers: Headers,
  query: { from?: string; to?: string; period?: string }
) =>
  Effect.gen(function* () {
    const input = yield* validateTaxReportQuery(query);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { taxReport: ['read'] })(authenticated);
    const days =
      (new Date(`${input.to}T00:00:00Z`).getTime() -
        new Date(`${input.from}T00:00:00Z`).getTime()) /
      86_400_000;
    if (days < 0 || days > MAX_REPORT_DAYS) return yield* Effect.fail(new TaxReportRangeError());
    const period: TaxReportPeriod = input.period ?? 'month';
    const from = instantAt(input.from, 0, TAX_REPORT_ZONE);
    // `to` is inclusive: up to the start of the next day.
    const to = new Date(instantAt(input.to, 0, TAX_REPORT_ZONE).getTime() + 86_400_000);
    const repo = yield* TaxReportRepo;
    const sources = yield* repo
      .listCollected({ from, to })
      .pipe((errors) => mapTaxRepoError(errors));
    const rows = aggregateTaxCollected(sources, period);
    return {
      from: input.from,
      to: input.to,
      period,
      rows,
      totalTaxCents: rows.reduce((total, row) => total + row.taxCents, 0)
    };
  });

// ---------------------------------------------------------------------------
// Responses

export type TaxRouteError =
  | Effect.Effect.Error<ReturnType<typeof getTaxAccessRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getTaxConfigRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof supersedeTaxRateRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof supersedeTaxTreatmentRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof supersedeTaxRegistrationRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listTaxAuditRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof taxCollectedReportRouteProgram>>;

const taxErrorToResponse = (c: HonoContext<HonoEnv>, error: TaxRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'TaxPastEffectiveDateError':
      return c.json(
        {
          error: {
            code: 'TAX_PAST_EFFECTIVE_DATE_UNCONFIRMED' as const,
            message: `${error.effectiveFrom} is already past. Confirm that the change applies from that date.`
          }
        },
        422
      );
    case 'TaxEffectiveRangeError':
      return c.json(
        {
          error: {
            code: 'TAX_EFFECTIVE_RANGE_INVALID' as const,
            message: 'The end date must be after the start date.'
          }
        },
        422
      );
    case 'TaxUnknownJurisdictionError':
      return c.json(
        {
          error: {
            code: 'TAX_UNKNOWN_JURISDICTION' as const,
            message: `${error.jurisdictionCode} is not a known jurisdiction.`
          }
        },
        422
      );
    case 'TaxConfigOverlapError':
      return c.json(
        {
          error: {
            code: 'TAX_CONFIG_OVERLAP' as const,
            message:
              'Another value already starts later in this range. Pick a date after it, or end the new value before it.'
          }
        },
        409
      );
    case 'TaxReportRangeError':
      return c.json(
        {
          error: {
            code: 'TAX_REPORT_RANGE_INVALID' as const,
            message: 'Pick an end date on or after the start date, at most three years later.'
          }
        },
        422
      );
    case 'TaxRepoError':
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, TaxRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return taxErrorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function getTaxAccessHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  return exitToResponse(
    c,
    await runtime.runPromiseExit(getTaxAccessRouteProgram(c.req.raw.headers))
  );
}

export async function getTaxConfigHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  return exitToResponse(
    c,
    await runtime.runPromiseExit(getTaxConfigRouteProgram(c.req.raw.headers))
  );
}

export async function supersedeTaxRateHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  return exitToResponse(
    c,
    await runtime.runPromiseExit(supersedeTaxRateRouteProgram(c, c.req.raw.headers))
  );
}

export async function supersedeTaxTreatmentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  return exitToResponse(
    c,
    await runtime.runPromiseExit(supersedeTaxTreatmentRouteProgram(c, c.req.raw.headers))
  );
}

export async function supersedeTaxRegistrationHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  return exitToResponse(
    c,
    await runtime.runPromiseExit(supersedeTaxRegistrationRouteProgram(c, c.req.raw.headers))
  );
}

export async function listTaxAuditHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  return exitToResponse(
    c,
    await runtime.runPromiseExit(
      listTaxAuditRouteProgram(c.req.raw.headers, {
        entity: c.req.query('entity'),
        limit: c.req.query('limit')
      })
    )
  );
}

const reportQuery = (c: HonoContext<HonoEnv>) => ({
  from: c.req.query('from'),
  to: c.req.query('to'),
  period: c.req.query('period')
});

export async function taxCollectedReportHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  return exitToResponse(
    c,
    await runtime.runPromiseExit(taxCollectedReportRouteProgram(c.req.raw.headers, reportQuery(c)))
  );
}

/** The same report as a CSV download. */
export async function taxCollectedCsvHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    taxCollectedReportRouteProgram(c.req.raw.headers, reportQuery(c))
  );
  if (Exit.isSuccess(exit)) {
    const report = exit.value;
    return c.body(taxCollectedCsv(report.rows), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tax-collected-${report.from}-to-${report.to}.csv"`
    });
  }
  return exitToResponse(c, exit);
}
