import { describe, expect, it } from 'bun:test';
import {
  ContractRepo,
  dummyContract,
  dummyContractBilling,
  dummySessionResolution,
  makeInMemoryContractBillingRepo,
  makeInMemorySessionResolutionRepo,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  type SessionRecord,
  type SessionResolution,
  type User
} from '@repo/db';
import { makeMailerTest, type ContractBillingNoticeMail } from '@repo/mail';
import { makeNotificationHubTest, type NotificationInput } from '@repo/notify';
import { Context, Effect, Layer } from 'effect';
import {
  availableSessionActions,
  cancellationCutoff,
  checkResponse,
  checkSessionAction,
  classifyCancellation,
  dayOffClassification,
  plannedResolution,
  runSessionResolutionTick,
  type ActionContext,
  type ResolutionPolicy
} from './resolutions';
import { resolutionCopyFor, sendResolutionNotice } from './resolution-notices';

const TORONTO = 'America/Toronto';
const WINNIPEG = 'America/Winnipeg';

const POLICY: ResolutionPolicy = {
  windowDays: 14,
  cancellationNoticeHours: 24,
  reportResponseHours: 48,
  reportWindowHours: 48,
  lateCancellationHelperBps: 2500
};

// Tue 3 Nov 2026, 15:30–17:30 in Toronto (EST, UTC−5).
const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'session-1',
  contractId: 'contract-1',
  cycleId: 'cycle-1',
  date: '2026-11-03',
  slot: 'svc-1@930',
  serviceId: 'svc-1',
  serviceName: 'Childcare',
  startMinutes: 930,
  endMinutes: 1050,
  startsAt: new Date('2026-11-03T20:30:00.000Z'),
  endsAt: new Date('2026-11-03T22:30:00.000Z'),
  elapsedMinutes: 120,
  rateCents: 2500,
  valueCents: 5000,
  status: 'scheduled',
  createdAt: new Date('2026-10-20T00:00:00.000Z'),
  updatedAt: new Date('2026-10-20T00:00:00.000Z'),
  ...overrides
});

const ctx = (overrides: Partial<ActionContext> = {}): ActionContext => ({
  session: session(),
  zone: TORONTO,
  now: new Date('2026-10-30T12:00:00.000Z'),
  policy: POLICY,
  side: 'family',
  active: null,
  ...overrides
});

describe('cancellationCutoff and classification (spec §6: exactly 24 h is timely)', () => {
  it('is the same wall-clock time the day before, in the contract zone', () => {
    const cutoff = cancellationCutoff(session(), TORONTO, 24);
    expect(cutoff.toISOString()).toBe('2026-11-02T20:30:00.000Z');
    expect(classifyCancellation('family', cutoff, cutoff)).toBe('family_cancelled_early');
    expect(classifyCancellation('family', new Date(cutoff.getTime() + 1), cutoff)).toBe(
      'family_cancelled_late'
    );
    expect(classifyCancellation('helper', new Date(cutoff.getTime() - 1), cutoff)).toBe(
      'helper_cancelled'
    );
  });

  it('reads the cutoff in the contract zone: the same instant can be early in Winnipeg', () => {
    const recordedAt = new Date('2026-11-02T21:00:00.000Z');
    const toronto = cancellationCutoff(session(), TORONTO, 24);
    const winnipeg = cancellationCutoff(session(), WINNIPEG, 24);
    expect(winnipeg.toISOString()).toBe('2026-11-02T21:30:00.000Z');
    expect(classifyCancellation('family', recordedAt, toronto)).toBe('family_cancelled_late');
    expect(classifyCancellation('family', recordedAt, winnipeg)).toBe('family_cancelled_early');
  });

  it('keeps the wall clock across the fall-back night (25 real hours)', () => {
    // Sun 1 Nov 2026 09:00 EST; the cutoff is Sat 31 Oct 09:00 EDT.
    const sunday = session({ date: '2026-11-01', startMinutes: 540, endMinutes: 660 });
    const cutoff = cancellationCutoff(sunday, TORONTO, 24);
    expect(cutoff.toISOString()).toBe('2026-10-31T13:00:00.000Z');
    // 24.5 real hours before the start, but after 09:00 on the clock: late.
    expect(classifyCancellation('family', new Date('2026-10-31T13:30:00.000Z'), cutoff)).toBe(
      'family_cancelled_late'
    );
    expect(classifyCancellation('family', cutoff, cutoff)).toBe('family_cancelled_early');
  });

  it('keeps the wall clock across the spring-forward night (23 real hours)', () => {
    // Sun 14 Mar 2027 09:00 EDT; the cutoff is Sat 13 Mar 09:00 EST.
    const sunday = session({ date: '2027-03-14', startMinutes: 540, endMinutes: 660 });
    expect(cancellationCutoff(sunday, TORONTO, 24).toISOString()).toBe('2027-03-13T14:00:00.000Z');
  });

  it('takes the moment the clock resumes for a cutoff inside the DST gap', () => {
    // 12 h before 14:30 on 14 Mar 2027 is 02:30, which doesn't exist: 03:00 EDT.
    const sunday = session({ date: '2027-03-14', startMinutes: 870, endMinutes: 990 });
    expect(cancellationCutoff(sunday, TORONTO, 12).toISOString()).toBe('2027-03-14T07:00:00.000Z');
  });

  it('crosses several days for a longer notice', () => {
    expect(cancellationCutoff(session(), TORONTO, 72).toISOString()).toBe(
      '2026-10-31T19:30:00.000Z'
    );
  });

  it('classifies a day off by who proposed it and when', () => {
    const early = dummySessionResolution({
      reportedBySide: 'family',
      recordedAt: new Date('2026-11-01T12:00:00.000Z')
    });
    expect(dayOffClassification(early, session(), TORONTO, POLICY)).toBe('family_cancelled_early');
    expect(
      dayOffClassification({ ...early, reportedBySide: 'helper' }, session(), TORONTO, POLICY)
    ).toBe('helper_cancelled');
  });
});

describe('checkSessionAction', () => {
  it('offers cancel and a day off before the cutoff, reports only once started', () => {
    expect(availableSessionActions(ctx()).actions).toEqual(['cancel', 'propose_day_off']);
    const during = ctx({ now: new Date('2026-11-03T21:00:00.000Z') });
    expect(availableSessionActions(during).actions).toEqual([
      'report_no_show',
      'report_reduced_hours',
      'dispute'
    ]);
  });

  it('refuses a session beyond the window (today + window − 1, contract zone)', () => {
    // Fri 30 Oct in Toronto: a 14-day window ends on Thu 12 Nov.
    expect(
      checkSessionAction('cancel', ctx({ session: session({ date: '2026-11-12' }) }))
    ).toBeNull();
    expect(checkSessionAction('cancel', ctx({ session: session({ date: '2026-11-13' }) }))).toBe(
      'outside_window'
    );
    const week = { ...POLICY, windowDays: 7 };
    expect(
      checkSessionAction('cancel', ctx({ session: session({ date: '2026-11-06' }), policy: week }))
    ).toBe('outside_window');
  });

  it('refuses suspended and cancelled sessions', () => {
    expect(checkSessionAction('cancel', ctx({ session: session({ status: 'suspended' }) }))).toBe(
      'session_unavailable'
    );
  });

  it('refuses cancelling a session that has started, and a day off past the cutoff', () => {
    const started = ctx({ now: new Date('2026-11-03T20:30:00.000Z') });
    expect(checkSessionAction('cancel', started)).toBe('already_started');
    const atCutoff = ctx({ now: new Date('2026-11-02T20:30:00.000Z') });
    expect(checkSessionAction('propose_day_off', atCutoff)).toBe('day_off_too_late');
    expect(checkSessionAction('cancel', atCutoff)).toBeNull();
  });

  it('refuses reports before the start and after the report window', () => {
    expect(checkSessionAction('report_no_show', ctx())).toBe('not_started');
    const late = ctx({ now: new Date('2026-11-05T22:30:00.001Z') });
    expect(checkSessionAction('report_no_show', late)).toBe('report_window_closed');
    expect(checkSessionAction('dispute', late)).toBe('report_window_closed');
    const lastMoment = ctx({ now: new Date('2026-11-05T22:30:00.000Z') });
    expect(checkSessionAction('report_reduced_hours', lastMoment)).toBeNull();
  });

  it('keeps one active resolution per session', () => {
    const active = dummySessionResolution({ status: 'confirmed', reportedBySide: 'helper' });
    expect(checkSessionAction('cancel', ctx({ active }))).toBe('already_resolved');
    expect(checkSessionAction('propose_day_off', ctx({ active }))).toBe('already_resolved');
  });

  it("disputes only the other side's confirmed resolution", () => {
    const theirs = dummySessionResolution({ status: 'confirmed', reportedBySide: 'helper' });
    expect(checkSessionAction('dispute', ctx({ active: theirs }))).toBeNull();
    expect(checkSessionAction('dispute', ctx({ active: theirs, side: 'helper' }))).toBe(
      'wrong_side'
    );
    expect(checkSessionAction('dispute', ctx({ active: { ...theirs, status: 'contested' } }))).toBe(
      'not_disputable'
    );
    // "It wasn't provided" needs the session to have started.
    expect(checkSessionAction('dispute', ctx())).toBe('not_started');
  });

  it('leaves a proposal to the answer buttons: no dispute while it is proposed', () => {
    // A proposed report is contested (and a day off declined) by answering;
    // a dispute would duplicate that, or skip the silence rule once the
    // response window has closed.
    const proposed = dummySessionResolution({ status: 'proposed', reportedBySide: 'helper' });
    expect(checkSessionAction('dispute', ctx({ active: proposed }))).toBe('not_disputable');
    const dayOff = { ...proposed, kind: 'day_off_agreed' as const };
    expect(checkSessionAction('dispute', ctx({ active: dayOff }))).toBe('not_disputable');
  });

  it('refuses disputing what the viewer accepted', () => {
    const accepted = dummySessionResolution({
      status: 'confirmed',
      reportedBySide: 'helper',
      response: 'accepted',
      respondedByUserId: 'family-1'
    });
    expect(checkSessionAction('dispute', ctx({ active: accepted }))).toBe('not_disputable');
    // Confirmed by silence (no answer) stays disputable within the window.
    const silent = { ...accepted, response: null, respondedByUserId: null };
    expect(checkSessionAction('dispute', ctx({ active: silent }))).toBeNull();
  });

  it('lets the proposer withdraw a pending day off until it is answered or lapses', () => {
    const cutoff = cancellationCutoff(session(), TORONTO, 24);
    const mine = dummySessionResolution({
      kind: 'day_off_agreed',
      status: 'proposed',
      reportedBySide: 'family',
      respondBy: cutoff
    });
    expect(checkSessionAction('withdraw_day_off', ctx({ active: mine }))).toBeNull();
    expect(availableSessionActions(ctx({ active: mine })).actions).toEqual(['withdraw_day_off']);
    expect(checkSessionAction('withdraw_day_off', ctx({ active: mine, side: 'helper' }))).toBe(
      'wrong_side'
    );
    expect(checkSessionAction('withdraw_day_off', ctx({ active: mine, now: cutoff }))).toBe(
      'response_window_closed'
    );
    expect(
      checkSessionAction('withdraw_day_off', ctx({ active: { ...mine, status: 'confirmed' } }))
    ).toBe('nothing_to_withdraw');
    const report = { ...mine, kind: 'helper_no_show' as const };
    expect(checkSessionAction('withdraw_day_off', ctx({ active: report }))).toBe(
      'nothing_to_withdraw'
    );
    expect(checkSessionAction('withdraw_day_off', ctx())).toBe('nothing_to_withdraw');
  });
});

describe('checkResponse', () => {
  const report = dummySessionResolution({
    kind: 'helper_no_show',
    reportedBySide: 'family',
    status: 'proposed',
    respondBy: new Date('2026-11-05T21:00:00.000Z')
  });
  const now = new Date('2026-11-04T12:00:00.000Z');

  it('lets the other side accept or contest a report before the deadline', () => {
    expect(checkResponse('accept', { now, side: 'helper', active: report })).toBeNull();
    expect(checkResponse('contest', { now, side: 'helper', active: report })).toBeNull();
    expect(checkResponse('decline', { now, side: 'helper', active: report })).toBe(
      'invalid_response'
    );
  });

  it('refuses the reporter answering their own report (wrong party)', () => {
    expect(checkResponse('accept', { now, side: 'family', active: report })).toBe('wrong_side');
  });

  it('refuses an answer once silence has already counted', () => {
    const later = new Date('2026-11-05T21:00:00.000Z');
    expect(checkResponse('contest', { now: later, side: 'helper', active: report })).toBe(
      'response_window_closed'
    );
  });

  it('answers a day off with accept or decline only', () => {
    const dayOff = { ...report, kind: 'day_off_agreed' as const };
    expect(checkResponse('decline', { now, side: 'helper', active: dayOff })).toBeNull();
    expect(checkResponse('contest', { now, side: 'helper', active: dayOff })).toBe(
      'invalid_response'
    );
    expect(checkResponse('accept', { now, side: 'helper', active: null })).toBe(
      'nothing_to_answer'
    );
  });
});

describe('plannedResolution', () => {
  it('confirms your own cancellation at once, classified by the cutoff', () => {
    expect(plannedResolution('cancel', ctx())).toEqual({
      kind: 'family_cancelled_early',
      status: 'confirmed',
      respondBy: null
    });
    const late = ctx({ now: new Date('2026-11-03T12:00:00.000Z') });
    expect(plannedResolution('cancel', late).kind).toBe('family_cancelled_late');
    expect(plannedResolution('cancel', ctx({ side: 'helper' })).kind).toBe('helper_cancelled');
  });

  it('proposes a day off until the cutoff and a report for the response window', () => {
    expect(plannedResolution('propose_day_off', ctx()).respondBy?.toISOString()).toBe(
      '2026-11-02T20:30:00.000Z'
    );
    const during = ctx({ now: new Date('2026-11-03T21:00:00.000Z') });
    expect(plannedResolution('report_no_show', during)).toEqual({
      kind: 'helper_no_show',
      status: 'proposed',
      respondBy: new Date('2026-11-05T21:00:00.000Z')
    });
    expect(plannedResolution('report_no_show', { ...during, side: 'helper' }).kind).toBe(
      'family_no_show'
    );
    expect(plannedResolution('dispute_new', during)).toEqual({
      kind: 'disputed',
      status: 'contested',
      respondBy: null
    });
  });
});

// ---------------------------------------------------------------------------
// The worker step and the notices

type Published = { userId: string; input: NotificationInput };

const user = (id: string): User =>
  ({ id, name: id, email: `${id}@example.test`, role: 'family' }) as unknown as User;

const makeWorld = (options: { resolutions: Array<SessionResolution>; helperLanguage?: string }) => {
  const billingRepo = makeInMemoryContractBillingRepo({
    billing: [dummyContractBilling({ contractId: 'contract-1', timeZone: TORONTO })]
  });
  billingRepo.state.sessions.push(session());
  const resolutions = makeInMemorySessionResolutionRepo({ resolutions: options.resolutions });
  const mails: Array<ContractBillingNoticeMail> = [];
  const alerts: Array<string> = [];
  const published: Array<Published> = [];
  const layer = Layer.mergeAll(
    billingRepo.layer,
    resolutions.layer,
    Layer.succeed(ContractRepo, {
      findById: () =>
        Effect.succeed({
          ...dummyContract,
          id: 'contract-1',
          familyUserId: 'family-1',
          providerUserId: 'helper-1'
        })
    } as unknown as Context.Tag.Service<typeof ContractRepo>),
    makeUserRepoTest({
      findById: (id) => Effect.succeed(user(id)),
      findByEmail: () => Effect.die('unused')
    }),
    makeUserProfileRepoTest({
      create: () => Effect.die('unused'),
      findByUserId: (userId) =>
        Effect.succeed({
          userId,
          firstName: userId === 'family-1' ? 'Priya' : 'Maria',
          lastName: 'Tester',
          language: userId === 'helper-1' ? (options.helperLanguage ?? 'fr') : 'en'
        } as never),
      updateByUserId: () => Effect.die('unused'),
      updateLocationByUserId: () => Effect.die('unused')
    }),
    makeMailerTest({
      sendContractBillingNotice: (mail) => Effect.sync(() => void mails.push(mail)),
      sendAdminBillingAlert: (mail) => Effect.sync(() => void alerts.push(mail.subject))
    }),
    makeNotificationHubTest({
      publish: (userId, input) => Effect.sync(() => void published.push({ userId, input })),
      subscribe: () => Effect.succeed({ unsubscribe: async () => {} })
    })
  );
  const tick = (iso: string) =>
    Effect.runPromise(runSessionResolutionTick(new Date(iso)).pipe(Effect.provide(layer)));
  return { layer, resolutions, mails, alerts, published, tick };
};

describe('runSessionResolutionTick (silence = acceptance, --as-of)', () => {
  const report = dummySessionResolution({
    id: 'report-1',
    kind: 'helper_no_show',
    reportedByUserId: 'family-1',
    reportedBySide: 'family',
    status: 'proposed',
    respondBy: new Date('2026-11-05T21:00:00.000Z')
  });

  it('leaves a report alone until its response window closes', async () => {
    const world = makeWorld({ resolutions: [report] });
    expect(await world.tick('2026-11-05T20:59:59.000Z')).toEqual({
      confirmed: 0,
      lapsed: 0,
      failed: 0
    });
    expect(world.resolutions.state.resolutions[0]?.status).toBe('proposed');
  });

  it('confirms an unanswered report when the window closes and tells both parties', async () => {
    const world = makeWorld({ resolutions: [report] });
    expect(await world.tick('2026-11-05T21:00:00.000Z')).toEqual({
      confirmed: 1,
      lapsed: 0,
      failed: 0
    });
    expect(world.resolutions.state.resolutions[0]?.status).toBe('confirmed');
    expect(world.resolutions.state.events.map((event) => [event.action, event.actorSide])).toEqual([
      ['confirmed_by_silence', 'system']
    ]);
    // Each party in their own language.
    const family = world.mails.find((mail) => mail.email.startsWith('family-1'));
    const helper = world.mails.find((mail) => mail.email.startsWith('helper-1'));
    expect(family?.locale).toBe('en');
    expect(family?.subject).toBe('Confirmed: a helper no-show on Tue, Nov 3');
    expect(family?.paragraphs[0]).toContain('no answer came within 48 hours');
    expect(helper?.locale).toBe('fr');
    expect(helper?.subject).toContain('Confirmé');
    expect(world.published.map((row) => [row.userId, row.input.type])).toEqual([
      ['family-1', 'contract.session'],
      ['helper-1', 'contract.session']
    ]);
    // A rerun changes nothing.
    expect((await world.tick('2026-11-05T21:15:00.000Z')).confirmed).toBe(0);
  });

  it('lapses an unconfirmed day off at the cancellation cutoff', async () => {
    const dayOff = dummySessionResolution({
      id: 'day-off-1',
      kind: 'day_off_agreed',
      reportedByUserId: 'helper-1',
      reportedBySide: 'helper',
      status: 'proposed',
      respondBy: new Date('2026-11-02T20:30:00.000Z')
    });
    const world = makeWorld({ resolutions: [dayOff] });
    expect(await world.tick('2026-11-02T20:30:00.000Z')).toEqual({
      confirmed: 0,
      lapsed: 1,
      failed: 0
    });
    expect(world.resolutions.state.resolutions[0]?.status).toBe('lapsed');
    expect(world.mails.map((mail) => mail.subject)).toEqual([
      'Day-off request lapsed for Tue, Nov 3',
      'Demande de congé expirée (mar. 3 nov.)'
    ]);
  });
});

describe('resolution notices', () => {
  const helperCancelled = dummySessionResolution({
    kind: 'helper_cancelled',
    reportedByUserId: 'helper-1',
    reportedBySide: 'helper',
    status: 'confirmed'
  });

  it('gives the family a replacement call to action when the helper cancels', async () => {
    const world = makeWorld({ resolutions: [helperCancelled] });
    await Effect.runPromise(
      sendResolutionNotice('recorded', {
        contract: {
          ...dummyContract,
          id: 'contract-1',
          familyUserId: 'family-1',
          providerUserId: 'helper-1'
        },
        session: session(),
        resolution: helperCancelled,
        zone: TORONTO,
        policy: POLICY
      }).pipe(Effect.provide(world.layer))
    );
    const family = world.mails.find((mail) => mail.email.startsWith('family-1'))!;
    expect(family.subject).toBe('Maria T. cancelled Tue, Nov 3');
    expect(family.secondaryLink?.label).toBe('Find a replacement');
    // Step 1b: Find help in "Find a replacement" mode for this session.
    const href = new URL(family.secondaryLink!.href);
    expect(href.pathname).toBe('/family/find');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      service: 'Childcare',
      replace: 'contract-1',
      sessions: session().id
    });
    expect(family.secondaryLink?.intro).toContain('offering Childcare');
    expect(family.link).toContain('/family/contracts/contract-1/cycles/cycle-1');
    const helper = world.mails.find((mail) => mail.email.startsWith('helper-1'))!;
    expect(helper.subject).toBe('Vous avez annulé la séance du mar. 3 nov.');
    expect(helper.secondaryLink).toBeNull();
    expect(helper.link).toContain('/service-provider/contracts/contract-1/cycles/cycle-1');
  });

  it('alerts the admins when a resolution is contested', async () => {
    const contested = {
      ...helperCancelled,
      status: 'contested' as const,
      respondedByUserId: 'family-1',
      responseNote: 'She came'
    };
    const world = makeWorld({ resolutions: [contested] });
    await Effect.runPromise(
      sendResolutionNotice('contested', {
        contract: {
          ...dummyContract,
          id: 'contract-1',
          familyUserId: 'family-1',
          providerUserId: 'helper-1'
        },
        session: session(),
        resolution: contested,
        zone: TORONTO,
        policy: POLICY
      }).pipe(Effect.provide(world.layer))
    );
    expect(world.alerts).toEqual(['Session dispute on contract contract-1']);
    const helper = world.mails.find((mail) => mail.email.startsWith('helper-1'))!;
    expect(helper.paragraphs).toContain('Déclaration : « She came »');
  });

  it('classifies a family cancellation in the copy, in each language', () => {
    const contract = {
      ...dummyContract,
      id: 'contract-1',
      familyUserId: 'family-1',
      providerUserId: 'helper-1'
    };
    const late = dummySessionResolution({
      kind: 'family_cancelled_late',
      reportedByUserId: 'family-1',
      reportedBySide: 'family',
      status: 'confirmed'
    });
    const context = {
      contract,
      session: session(),
      resolution: late,
      zone: TORONTO,
      policy: POLICY
    };
    const names = { family: 'Priya T.', helper: 'Maria T.' };
    const toHelper = resolutionCopyFor('recorded', 'helper', context, names, 'en');
    expect(toHelper.subject).toBe('Priya T. cancelled Tue, Nov 3');
    expect(toHelper.paragraphs[0]).toContain('less than 24 hours before the session');
    const toFamily = resolutionCopyFor('recorded', 'family', context, names, 'fr');
    expect(toFamily.paragraphs[0]).toContain('annulation tardive');
    expect(toFamily.paragraphs[1]).toBe('Maria T. a été avisé(e).');
  });

  it('reads cleanly: one full stop after "p.m.", one pair of brackets, a labelled deadline', () => {
    const contract = {
      ...dummyContract,
      id: 'contract-1',
      familyUserId: 'family-1',
      providerUserId: 'helper-1'
    };
    const names = { family: 'Priya T.', helper: 'Maria T.' };
    const early = dummySessionResolution({
      kind: 'family_cancelled_early',
      reportedByUserId: 'family-1',
      reportedBySide: 'family',
      status: 'confirmed'
    });
    const base = { contract, session: session(), zone: TORONTO, policy: POLICY };
    const cancelled = resolutionCopyFor(
      'recorded',
      'helper',
      { ...base, resolution: early },
      names,
      'en'
    );
    expect(cancelled.paragraphs.join(' ')).not.toContain('..');
    // The same words as the cycle page ("on time").
    expect(cancelled.paragraphs[0]).toContain('on-time cancellation');
    const reduced = dummySessionResolution({
      kind: 'family_reduced_hours',
      reportedByUserId: 'family-1',
      reportedBySide: 'family',
      minutesWorked: 60,
      status: 'proposed',
      respondBy: new Date('2026-11-05T21:00:00.000Z')
    });
    const report = resolutionCopyFor(
      'recorded',
      'helper',
      { ...base, resolution: reduced },
      names,
      'en'
    );
    const text = [report.subject, ...report.paragraphs].join(' ');
    expect(text).not.toContain('..');
    expect(text).not.toMatch(/\)\s*\(/);
    // The deadline says which zone it is in.
    expect(report.paragraphs[1]).toContain('EST');
  });
});
