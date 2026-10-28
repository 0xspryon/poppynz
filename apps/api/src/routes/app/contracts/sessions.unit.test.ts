import { dummyContract, dummySessionResolution } from '@repo/db';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  cycleSessionResolutions,
  listPendingSessionResponsesRouteProgram,
  recordSessionActionRouteProgram,
  respondToSessionRouteProgram
} from './sessions';
import {
  CONTRACT_ID,
  CUTOFF,
  CYCLE_ID,
  HELPER,
  OUTSIDER,
  SESSION_ID,
  failureOf,
  makeContext,
  makeSessionWorld
} from './sessions.test-support';

type World = ReturnType<typeof makeSessionWorld>;

const params = { id: CONTRACT_ID, sessionId: SESSION_ID };
const BEFORE = new Date('2026-10-30T12:00:00.000Z'); // well before the cutoff
const DURING = new Date('2026-11-03T21:00:00.000Z'); // the session is under way

const act = (world: World, body: unknown, now: Date = BEFORE) =>
  Effect.runPromiseExit(
    recordSessionActionRouteProgram(makeContext({ params, body }), new Headers(), now).pipe(
      Effect.provide(world.layer)
    )
  );

const respond = (world: World, body: unknown, now: Date = DURING) =>
  Effect.runPromiseExit(
    respondToSessionRouteProgram(makeContext({ params, body }), new Headers(), now).pipe(
      Effect.provide(world.layer)
    )
  );

const pending = (world: World, now: Date = DURING) =>
  Effect.runPromise(
    listPendingSessionResponsesRouteProgram(
      makeContext({ params: { id: CONTRACT_ID } }),
      new Headers(),
      now
    ).pipe(Effect.provide(world.layer))
  );

const resolutionOf = (
  exit: Exit.Exit<{ resolution: { kind: string; status: string } }, unknown>
) => {
  if (!Exit.isSuccess(exit))
    throw new Error(`expected success, got ${JSON.stringify(failureOf(exit))}`);
  return exit.value.resolution;
};

describe('POST /contracts/:id/sessions/:sessionId/actions — cancel', () => {
  it("records the family's early cancellation as confirmed, with the signed policy version", async () => {
    const world = makeSessionWorld();
    const resolution = resolutionOf(await act(world, { action: 'cancel', reason: 'illness' }));
    expect(resolution).toMatchObject({
      kind: 'family_cancelled_early',
      status: 'confirmed',
      reportedByMe: true,
      reason: 'illness',
      policyVersion: 5
    });
    const [row] = world.resolutions.state.resolutions;
    expect(row).toMatchObject({ cycleId: CYCLE_ID, policyVersionId: 'tos-v5', respondBy: null });
    expect(world.resolutions.state.events.map((event) => [event.action, event.actorSide])).toEqual([
      ['recorded', 'family']
    ]);
    // Both parties are told, each in their own language.
    expect(world.mails.map((mail) => [mail.email, mail.locale, mail.subject])).toEqual([
      ['family-1@example.test', 'en', 'You cancelled Tue, Nov 3'],
      ['helper-1@example.test', 'fr', 'Priya T. a annulé la séance du mar. 3 nov.']
    ]);
    expect(world.published.map((row) => row.input.type)).toEqual([
      'contract.session',
      'contract.session'
    ]);
  });

  it('counts exactly the cutoff as early and a minute later as late', async () => {
    const atCutoff = makeSessionWorld();
    expect(resolutionOf(await act(atCutoff, { action: 'cancel' }, CUTOFF)).kind).toBe(
      'family_cancelled_early'
    );
    const after = makeSessionWorld();
    expect(
      resolutionOf(await act(after, { action: 'cancel' }, new Date(CUTOFF.getTime() + 60_000))).kind
    ).toBe('family_cancelled_late');
  });

  it("records the helper's cancellation and offers the family a replacement", async () => {
    const world = makeSessionWorld({ viewer: HELPER });
    expect(resolutionOf(await act(world, { action: 'cancel' })).kind).toBe('helper_cancelled');
    const family = world.mails.find((mail) => mail.email.startsWith('family-1'))!;
    expect(family.secondaryLink?.label).toBe('Find a replacement');
    expect(family.secondaryLink?.href).toContain('/family/find?service=Childcare');
  });

  it('falls back to the published Terms of Service without a signed policy', async () => {
    const world = makeSessionWorld({ signatures: [], publishedTermsVersion: 6 });
    expect(resolutionOf(await act(world, { action: 'cancel' }))).toMatchObject({
      policyVersion: 6
    });
    const none = makeSessionWorld({ signatures: [], publishedTermsVersion: null });
    expect(resolutionOf(await act(none, { action: 'cancel' }))).toMatchObject({
      policyVersion: null
    });
  });

  it('is denied without the session-resolution permission (403), recording nothing', async () => {
    const world = makeSessionWorld({ grants: ['contract:read', 'sessionResolution:read'] });
    expect(failureOf(await act(world, { action: 'cancel' }))?._tag).toBe('ForbiddenError');
    expect(world.resolutions.state.resolutions).toEqual([]);
    expect(world.mails).toEqual([]);
  });

  it("refuses someone who isn't a party to the contract (404)", async () => {
    const world = makeSessionWorld({ viewer: OUTSIDER });
    expect(failureOf(await act(world, { action: 'cancel' }))?._tag).toBe('SessionNotFoundError');
  });

  it('refuses a session outside the window', async () => {
    const world = makeSessionWorld({ session: { date: '2026-11-20' } });
    expect(failureOf(await act(world, { action: 'cancel' }))).toMatchObject({
      _tag: 'SessionActionRefusedError',
      reason: 'outside_window'
    });
  });

  it('refuses cancelling a session that has started', async () => {
    const world = makeSessionWorld();
    expect(failureOf(await act(world, { action: 'cancel' }, DURING))?.reason).toBe(
      'already_started'
    );
  });

  it('keeps one active resolution per session', async () => {
    const world = makeSessionWorld();
    await act(world, { action: 'cancel' });
    const helper = makeSessionWorld({
      viewer: HELPER,
      resolutions: [...world.resolutions.state.resolutions]
    });
    expect(failureOf(await act(helper, { action: 'cancel' }))?.reason).toBe('already_resolved');
    expect(failureOf(await act(world, { action: 'propose_day_off' }))?.reason).toBe(
      'already_resolved'
    );
  });

  it('answers a database failure with the repo error', async () => {
    const world = makeSessionWorld({ repoDown: true });
    expect(failureOf(await act(world, { action: 'cancel' }))?._tag).toBe('SessionRepoError');
  });

  it('validates the body', async () => {
    const world = makeSessionWorld();
    expect(failureOf(await act(world, { action: 'teleport' }))?._tag).toBe(
      'RequestValidationError'
    );
  });
});

describe('days off', () => {
  it('proposes a day off that lapses at the cutoff; the other side confirms it', async () => {
    const world = makeSessionWorld({ viewer: HELPER });
    const proposed = resolutionOf(await act(world, { action: 'propose_day_off' }));
    expect(proposed).toMatchObject({
      kind: 'day_off_agreed',
      status: 'proposed',
      respondBy: CUTOFF.toISOString(),
      countsAs: 'helper_cancelled'
    });
    const family = makeSessionWorld({ resolutions: [...world.resolutions.state.resolutions] });
    expect((await pending(family, BEFORE)).items).toHaveLength(1);
    const accepted = resolutionOf(await respond(family, { response: 'accept' }, BEFORE));
    expect(accepted).toMatchObject({ status: 'confirmed', response: 'accepted' });
    expect(family.mails.map((mail) => mail.subject)).toEqual([
      'Day off agreed for Tue, Nov 3',
      'Congé convenu le mar. 3 nov.'
    ]);
  });

  it('can be declined (the session goes ahead) but not contested', async () => {
    const dayOff = dummySessionResolution({
      id: 'day-off-1',
      sessionId: SESSION_ID,
      contractId: CONTRACT_ID,
      cycleId: CYCLE_ID,
      kind: 'day_off_agreed',
      reportedByUserId: 'family-1',
      reportedBySide: 'family',
      status: 'proposed',
      respondBy: CUTOFF
    });
    const helper = makeSessionWorld({ viewer: HELPER, resolutions: [dayOff] });
    expect(failureOf(await respond(helper, { response: 'contest' }, BEFORE))?.reason).toBe(
      'invalid_response'
    );
    expect(resolutionOf(await respond(helper, { response: 'decline' }, BEFORE))).toMatchObject({
      status: 'reversed',
      response: 'declined'
    });
  });

  it('refuses a day off proposed at or after the cutoff', async () => {
    const world = makeSessionWorld();
    expect(failureOf(await act(world, { action: 'propose_day_off' }, CUTOFF))?.reason).toBe(
      'day_off_too_late'
    );
  });
});

describe('reports and responses', () => {
  it('reports a no-show about the other side, answerable by them only', async () => {
    const world = makeSessionWorld();
    const report = resolutionOf(await act(world, { action: 'report_no_show' }, DURING));
    expect(report).toMatchObject({
      kind: 'helper_no_show',
      status: 'proposed',
      respondBy: '2026-11-05T21:00:00.000Z'
    });
    // The reporter can't answer their own report (wrong party).
    expect(failureOf(await respond(world, { response: 'accept' }))).toMatchObject({
      _tag: 'SessionActionRefusedError',
      reason: 'wrong_side'
    });
    expect((await pending(world)).items).toEqual([]);
    const helper = makeSessionWorld({
      viewer: HELPER,
      resolutions: [...world.resolutions.state.resolutions]
    });
    expect((await pending(helper)).items.map((item) => item.resolution.kind)).toEqual([
      'helper_no_show'
    ]);
    const contested = resolutionOf(
      await respond(helper, { response: 'contest', note: 'I was there at 15:25.' })
    );
    expect(contested).toMatchObject({ status: 'contested', responseNote: 'I was there at 15:25.' });
    expect(helper.alerts).toEqual([`Session dispute on contract ${CONTRACT_ID}`]);
  });

  it('accepts a report', async () => {
    const report = dummySessionResolution({
      sessionId: SESSION_ID,
      contractId: CONTRACT_ID,
      cycleId: CYCLE_ID,
      kind: 'helper_no_show',
      reportedByUserId: 'family-1',
      reportedBySide: 'family',
      status: 'proposed',
      respondBy: new Date('2026-11-05T21:00:00.000Z')
    });
    const helper = makeSessionWorld({ viewer: HELPER, resolutions: [report] });
    expect(resolutionOf(await respond(helper, { response: 'accept' }))).toMatchObject({
      status: 'confirmed',
      respondedByMe: true
    });
    expect(
      helper.resolutions.state.events.map((event) => [
        event.action,
        event.fromStatus,
        event.toStatus
      ])
    ).toEqual([['accepted', 'proposed', 'confirmed']]);
  });

  it('refuses an answer after the response window', async () => {
    const report = dummySessionResolution({
      sessionId: SESSION_ID,
      contractId: CONTRACT_ID,
      cycleId: CYCLE_ID,
      reportedBySide: 'family',
      status: 'proposed',
      respondBy: new Date('2026-11-05T21:00:00.000Z')
    });
    const helper = makeSessionWorld({ viewer: HELPER, resolutions: [report] });
    expect(
      failureOf(await respond(helper, { response: 'contest' }, new Date('2026-11-05T21:00:00Z')))
        ?.reason
    ).toBe('response_window_closed');
  });

  it('records reduced hours with the minutes worked, below the session length', async () => {
    const world = makeSessionWorld({ viewer: HELPER });
    expect(
      failureOf(await act(world, { action: 'report_reduced_hours', minutesWorked: 120 }, DURING))
        ?.reason
    ).toBe('invalid_minutes');
    expect(failureOf(await act(world, { action: 'report_reduced_hours' }, DURING))?.reason).toBe(
      'invalid_minutes'
    );
    expect(
      resolutionOf(await act(world, { action: 'report_reduced_hours', minutesWorked: 75 }, DURING))
    ).toMatchObject({ kind: 'family_reduced_hours', minutesWorked: 75, status: 'proposed' });
  });

  it('refuses reports before the session starts and after the report window', async () => {
    const world = makeSessionWorld();
    expect(failureOf(await act(world, { action: 'report_no_show' }))?.reason).toBe('not_started');
    expect(
      failureOf(await act(world, { action: 'report_no_show' }, new Date('2026-11-05T22:31:00Z')))
        ?.reason
    ).toBe('report_window_closed');
  });

  it('is denied without permission to answer (403)', async () => {
    const helper = makeSessionWorld({ viewer: HELPER, grants: ['contract:read'] });
    expect(failureOf(await respond(helper, { response: 'accept' }))?._tag).toBe('ForbiddenError');
    expect(
      failureOf(
        await Effect.runPromiseExit(
          listPendingSessionResponsesRouteProgram(
            makeContext({ params: { id: CONTRACT_ID } }),
            new Headers()
          ).pipe(Effect.provide(helper.layer))
        )
      )?._tag
    ).toBe('ForbiddenError');
  });
});

describe('disputes', () => {
  const helperCancelled = dummySessionResolution({
    sessionId: SESSION_ID,
    contractId: CONTRACT_ID,
    cycleId: CYCLE_ID,
    kind: 'helper_cancelled',
    reportedByUserId: 'helper-1',
    reportedBySide: 'helper',
    status: 'confirmed'
  });

  it("contests the other side's confirmed resolution, sending it to the admins", async () => {
    const world = makeSessionWorld({ resolutions: [helperCancelled] });
    const exit = await act(world, { action: 'dispute', note: 'She worked the session.' }, DURING);
    expect(resolutionOf(exit)).toMatchObject({
      kind: 'helper_cancelled',
      status: 'contested',
      responseNote: 'She worked the session.'
    });
    expect(world.alerts).toHaveLength(1);
  });

  it('refuses disputing a proposal (it is answered instead) and what you accepted', async () => {
    const proposed = {
      ...helperCancelled,
      kind: 'family_no_show' as const,
      status: 'proposed' as const
    };
    const world = makeSessionWorld({ resolutions: [proposed] });
    expect(failureOf(await act(world, { action: 'dispute' }, DURING))?.reason).toBe(
      'not_disputable'
    );
    const accepted = { ...proposed, status: 'confirmed' as const, response: 'accepted' as const };
    const later = makeSessionWorld({ resolutions: [accepted] });
    expect(failureOf(await act(later, { action: 'dispute' }, DURING))?.reason).toBe(
      'not_disputable'
    );
  });

  it('refuses disputing your own resolution (wrong party)', async () => {
    const world = makeSessionWorld({ viewer: HELPER, resolutions: [helperCancelled] });
    expect(failureOf(await act(world, { action: 'dispute' }, DURING))?.reason).toBe('wrong_side');
  });

  it('records "care wasn\'t provided" straight into the admin queue', async () => {
    const world = makeSessionWorld();
    expect(
      resolutionOf(await act(world, { action: 'dispute', note: 'Nobody came.' }, DURING))
    ).toMatchObject({ kind: 'disputed', status: 'contested' });
    expect(world.alerts).toHaveLength(1);
  });

  it('refuses a dispute after the report window', async () => {
    const world = makeSessionWorld({ resolutions: [helperCancelled] });
    expect(
      failureOf(await act(world, { action: 'dispute' }, new Date('2026-11-06T00:00:00Z')))?.reason
    ).toBe('report_window_closed');
  });
});

describe('who may act', () => {
  it('a family member of another contract cannot answer either', async () => {
    const world = makeSessionWorld({ viewer: OUTSIDER });
    expect(failureOf(await respond(world, { response: 'accept' }))?._tag).toBe(
      'SessionNotFoundError'
    );
  });
});

describe('cycleSessionResolutions (the cycle page)', () => {
  const contract = {
    ...dummyContract,
    id: CONTRACT_ID,
    familyUserId: 'family-1',
    providerUserId: 'helper-1',
    status: 'active' as const
  };
  const views = (world: World, viewerUserId: string, canAct: boolean, now = BEFORE) =>
    Effect.runPromise(
      cycleSessionResolutions({
        contract,
        viewerUserId,
        sessions: world.billing.state.sessions,
        zone: 'America/Toronto',
        now,
        canAct
      }).pipe(Effect.provide(world.layer))
    );

  it("offers the viewer's actions now, what cancelling would count as, and the window", async () => {
    const world = makeSessionWorld();
    const result = await views(world, 'family-1', true);
    expect(result.sessionWindow).toEqual({
      windowDays: 14,
      cancellationNoticeHours: 24,
      reportResponseHours: 48,
      reportWindowHours: 48
    });
    expect(result.perSession.get(SESSION_ID)).toEqual({
      resolution: null,
      actions: ['cancel', 'propose_day_off'],
      responses: [],
      cancelOutcome: 'family_cancelled_early',
      cutoffAt: CUTOFF.toISOString()
    });
  });

  it('offers nothing without the permission, but still shows the resolution', async () => {
    const world = makeSessionWorld({
      resolutions: [
        dummySessionResolution({
          sessionId: SESSION_ID,
          contractId: CONTRACT_ID,
          kind: 'day_off_agreed',
          reportedByUserId: 'family-1',
          reportedBySide: 'family',
          status: 'proposed',
          recordedAt: BEFORE,
          respondBy: CUTOFF
        })
      ]
    });
    const helper = (await views(world, 'helper-1', false)).perSession.get(SESSION_ID);
    expect(helper?.actions).toEqual([]);
    expect(helper?.responses).toEqual([]);
    expect(helper?.resolution).toMatchObject({
      kind: 'day_off_agreed',
      reportedByMe: false,
      countsAs: 'family_cancelled_early'
    });
    const answering = (await views(world, 'helper-1', true)).perSession.get(SESSION_ID);
    expect(answering?.responses).toEqual(['accept', 'decline']);
  });

  it('shows a lapsed day off once nothing is active', async () => {
    const world = makeSessionWorld({
      resolutions: [
        dummySessionResolution({
          sessionId: SESSION_ID,
          contractId: CONTRACT_ID,
          kind: 'day_off_agreed',
          status: 'lapsed'
        })
      ]
    });
    const view = (
      await views(world, 'family-1', true, new Date('2026-11-03T00:00:00Z'))
    ).perSession.get(SESSION_ID);
    expect(view?.resolution?.status).toBe('lapsed');
    // A lapsed day off counts as nothing: the session goes ahead.
    expect(view?.resolution?.countsAs).toBeNull();
    // The session is free again: it can still be cancelled (late now).
    expect(view?.actions).toEqual(['cancel']);
    expect(view?.cancelOutcome).toBe('family_cancelled_late');
  });
});
