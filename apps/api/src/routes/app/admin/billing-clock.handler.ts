/**
 * Staging UAT — the admin billing fast-forward (docs/staging-uat.md):
 *
 *   GET  /admin/capabilities                       always mounted: whether
 *                                                  the billing clock is on
 *                                                  for this admin (nav)
 *   GET  /admin/billing-clock/contracts            live contracts (family,
 *                                                  helper, status, next
 *                                                  event) and recent runs
 *   GET  /admin/billing-clock/contracts/:id        one contract: its cycles,
 *                                                  upcoming events, runs
 *   POST /admin/billing-clock/contracts/:id/runs   run its billing as of
 *                                                  `until` (after now, at
 *                                                  most BILLING_TIME_TRAVEL_
 *                                                  MAX_DAYS ahead)
 *
 * The /admin/billing-clock routes are mounted only when the switch is on
 * (checkBillingTimeTravel: ENVIRONMENT staging|dev, BILLING_TIME_TRAVEL=
 * enabled, a Stripe test key); every program re-checks it and answers 404
 * otherwise. Gated by the `billingClock: advance` permission (admins). The
 * run itself — scoped tick steps, audit row, one run per contract — is
 * `runBillingClock` in @repo/billing, which explains why it runs in the API.
 */
import {
  BillingClockError,
  loadBillingClockEvents,
  runBillingClock,
  type BillingClockEvent
} from '@repo/billing';
import {
  BillingClockRunRepo,
  ContractBillingRepo,
  ContractRepo,
  UserProfileRepo,
  UserRepo,
  type BillingClockRun
} from '@repo/db';
import { billingTimeTravelConfig, checkBillingTimeTravel } from '@repo/env';
import { Cause, Data, Effect, Exit, Option, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  AuthService,
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';
import {
  parseJsonBody,
  requestValidationErrorToResponse,
  validateInput
} from '@/api/lib/schema-validator';

type RawEnv = Record<string, string | undefined>;

/** The switch is off here: the routes behave as if they did not exist. */
export class BillingClockDisabledError extends Data.TaggedError('BillingClockDisabledError')<{}> {}

/** Anything below the fast-forward rules failed (database, provider, settings). */
export class BillingClockRepoError extends Data.TaggedError('BillingClockRepoError')<{
  cause: unknown;
}> {}

/** Keeps the typed refusals; anything else is an infrastructure failure. */
const mapBillingClockFailure = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, BillingClockError | BillingClockRepoError, R> =>
  effect.pipe(
    Effect.catchAll(
      (error): Effect.Effect<never, BillingClockError | BillingClockRepoError> =>
        error instanceof BillingClockError
          ? Effect.fail(error)
          : Effect.fail(new BillingClockRepoError({ cause: error }))
    )
  );

export const isBillingClockEnabled = (env: RawEnv = process.env) =>
  checkBillingTimeTravel(env).enabled;

const requireEnabled = (env: RawEnv) =>
  isBillingClockEnabled(env) ? Effect.void : Effect.fail(new BillingClockDisabledError());

const gate = (headers: Headers) =>
  Effect.flatMap(authenticate(headers), requirePermissions(headers, { billingClock: ['advance'] }));

const contractIdOf = validateInput(Schema.UUID, {
  code: 'INVALID_BILLING_CLOCK_CONTRACT',
  message: 'A valid contract id is required.'
} as const);

export const runValidationError = {
  code: 'INVALID_BILLING_CLOCK_RUN',
  message: 'Give the instant to run billing up to (an ISO date-time).'
} as const;
export const runSchema = Schema.Struct({
  until: Schema.String.pipe(
    Schema.filter((value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)))
  )
});
const validateRun = validateInput(runSchema, runValidationError);

const DAY_MS = 86_400_000;
const RECENT_RUNS = 20;

const maxDaysOf = billingTimeTravelConfig.pipe(
  Effect.map(({ maxDays }) => maxDays),
  (errors) => mapBillingClockFailure(errors)
);

/** "Priya Tester" — admins see full names. */
const fullName = (userId: string) =>
  Effect.gen(function* () {
    const profile = yield* (yield* UserProfileRepo)
      .findByUserId(userId)
      .pipe(Effect.orElseSucceed(() => null));
    const named = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
    if (named) return named;
    const user = yield* (yield* UserRepo).findById(userId).pipe(Effect.orElseSucceed(() => null));
    return user?.name ?? 'Poppynz member';
  });

const eventView = (event: BillingClockEvent, now: Date, maxDays: number) => ({
  kind: event.kind,
  at: event.at.toISOString(),
  label: event.label,
  cycleNumber: event.cycleNumber,
  date: event.date,
  endDate: event.endDate,
  subjectId: event.subjectId,
  // Beyond the horizon: listed, but it can't be run up to.
  withinLimit: event.at.getTime() - now.getTime() <= maxDays * DAY_MS
});

const runsView = (runs: ReadonlyArray<BillingClockRun>) =>
  Effect.gen(function* () {
    const names = new Map<string, string>();
    for (const run of runs) {
      if (!names.has(run.actorUserId)) names.set(run.actorUserId, yield* fullName(run.actorUserId));
    }
    return runs.map((run) => ({
      id: run.id,
      contractId: run.contractId,
      actorName: names.get(run.actorUserId)!,
      targetAt: run.targetAt.toISOString(),
      eventKind: run.eventKind,
      eventLabel: run.eventLabel,
      status: run.status,
      billingStatusBefore: run.billingStatusBefore,
      billingStatusAfter: run.billingStatusAfter,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null
    }));
  });

const partiesOf = (contractId: string) =>
  Effect.gen(function* () {
    const contract = yield* (yield* ContractRepo).findById(contractId);
    return {
      familyName: contract ? yield* fullName(contract.familyUserId) : null,
      helperName: contract ? yield* fullName(contract.providerUserId) : null
    };
  });

// ---------------------------------------------------------------------------
// Programs

/** Every live contract with its next billing event, and the latest runs. */
export const listBillingClockContractsProgram = (now: Date, maxDays: number) =>
  Effect.gen(function* () {
    const live = yield* (yield* ContractBillingRepo).listLiveBilling();
    const contracts = [];
    for (const billing of live) {
      const events = yield* loadBillingClockEvents(billing.contractId, now);
      contracts.push({
        contractId: billing.contractId,
        ...(yield* partiesOf(billing.contractId)),
        status: billing.status,
        suspendedReason: billing.suspendedReason,
        startsOn: billing.startsOn,
        nextEvent: events[0] ? eventView(events[0], now, maxDays) : null
      });
    }
    const runs = yield* runsView(
      yield* (yield* BillingClockRunRepo).listRecent({ limit: RECENT_RUNS })
    );
    return { contracts, runs, maxDays };
  }).pipe((errors) => mapBillingClockFailure(errors));

/** One contract: its cycles, every upcoming event and its latest runs. */
export const getBillingClockContractProgram = (contractId: string, now: Date, maxDays: number) =>
  Effect.gen(function* () {
    const billingRepo = yield* ContractBillingRepo;
    const billing = yield* billingRepo.findBilling(contractId);
    if (!billing) return yield* Effect.fail(new BillingClockError({ reason: 'not_found' }));
    const cycles = yield* billingRepo.listCycles(contractId);
    const events = yield* loadBillingClockEvents(contractId, now);
    const runs = yield* runsView(
      yield* (yield* BillingClockRunRepo).listRecent({ contractId, limit: RECENT_RUNS })
    );
    return {
      contract: {
        contractId,
        ...(yield* partiesOf(contractId)),
        status: billing.status,
        suspendedReason: billing.suspendedReason,
        timeZone: billing.timeZone,
        startsOn: billing.startsOn
      },
      cycles: cycles.slice(0, 12).map((cycle) => ({
        id: cycle.id,
        number: cycle.index + 1,
        startsOn: cycle.startsOn,
        endsOn: cycle.endsOn,
        status: cycle.status,
        familyTotalCents: cycle.familyTotalCents,
        holdAt: cycle.holdAt.toISOString(),
        captureAt: cycle.captureAt.toISOString(),
        transferAt: cycle.transferAt.toISOString()
      })),
      events: events.map((event) => eventView(event, now, maxDays)),
      runs,
      now: now.toISOString(),
      maxDays
    };
  }).pipe((errors) => mapBillingClockFailure(errors));

// ---------------------------------------------------------------------------
// Route programs

/** Always mounted: the admin nav shows "Billing clock" only when this says so. */
export const billingClockCapabilitiesRouteProgram = (headers: Headers, env: RawEnv = process.env) =>
  Effect.gen(function* () {
    yield* authenticate(headers);
    if (!isBillingClockEnabled(env)) return { billingClock: { enabled: false, maxDays: null } };
    const allowed = yield* (yield* AuthService).userHasPermission(headers, {
      billingClock: ['advance']
    });
    if (!allowed) return { billingClock: { enabled: false, maxDays: null } };
    return { billingClock: { enabled: true, maxDays: yield* maxDaysOf } };
  });

export const listBillingClockContractsRouteProgram = (
  headers: Headers,
  env: RawEnv = process.env,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    yield* requireEnabled(env);
    yield* gate(headers);
    return yield* listBillingClockContractsProgram(now, yield* maxDaysOf);
  });

export const getBillingClockContractRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  env: RawEnv = process.env,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    yield* requireEnabled(env);
    const contractId = yield* contractIdOf(c.req.param('id'));
    yield* gate(headers);
    return yield* getBillingClockContractProgram(contractId, now, yield* maxDaysOf);
  });

export const runBillingClockRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  env: RawEnv = process.env,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    yield* requireEnabled(env);
    const contractId = yield* contractIdOf(c.req.param('id'));
    const input = yield* validateRun(yield* parseJsonBody(c, runValidationError));
    const admin = yield* gate(headers);
    const run = yield* runBillingClock({
      contractId,
      until: new Date(input.until),
      actorUserId: admin.user.id,
      now,
      maxDays: yield* maxDaysOf
    }).pipe((errors) => mapBillingClockFailure(errors));
    const [view] = yield* runsView([run]).pipe((errors) => mapBillingClockFailure(errors));
    return { run: view! };
  });

type BillingClockRouteError =
  | Effect.Effect.Error<ReturnType<typeof billingClockCapabilitiesRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listBillingClockContractsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getBillingClockContractRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof runBillingClockRouteProgram>>;

const refusalToResponse = (c: HonoContext<HonoEnv>, error: BillingClockError) => {
  const reason = error.reason;
  switch (reason) {
    case 'not_found':
      return c.json(
        {
          error: {
            code: 'BILLING_CLOCK_CONTRACT_NOT_FOUND' as const,
            message: 'This contract has no billing.'
          }
        },
        404
      );
    case 'not_in_future':
      return c.json(
        {
          error: {
            code: 'BILLING_CLOCK_NOT_IN_FUTURE' as const,
            message: 'Choose an instant after the current time.'
          }
        },
        422
      );
    case 'too_far':
      return c.json(
        {
          error: {
            code: 'BILLING_CLOCK_TOO_FAR' as const,
            message: 'That instant is further ahead than the fast-forward allows.'
          }
        },
        422
      );
    case 'already_running':
      return c.json(
        {
          error: {
            code: 'BILLING_CLOCK_ALREADY_RUNNING' as const,
            message: 'This contract’s billing is already being run.'
          }
        },
        409
      );
    default:
      return handleNever(c, reason);
  }
};

const errorToResponse = (c: HonoContext<HonoEnv>, error: BillingClockRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'BillingClockDisabledError':
      return c.json(
        { error: { code: 'NOT_FOUND' as const, message: 'Not found.' } },
        404
      );
    case 'BillingClockError':
      return refusalToResponse(c, error);
    case 'BillingClockRepoError':
      return c.json(
        {
          error: {
            code: 'BILLING_CLOCK_FAILED' as const,
            message: 'Unable to process the request.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, BillingClockRouteError>) =>
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

export async function billingClockCapabilitiesHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(billingClockCapabilitiesRouteProgram(c.req.raw.headers))
  );
}
export async function listBillingClockContractsHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c
      .get('runtime')
      .runPromiseExit(listBillingClockContractsRouteProgram(c.req.raw.headers))
  );
}
export async function getBillingClockContractHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c
      .get('runtime')
      .runPromiseExit(getBillingClockContractRouteProgram(c, c.req.raw.headers))
  );
}
export async function runBillingClockHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(runBillingClockRouteProgram(c, c.req.raw.headers))
  );
}
