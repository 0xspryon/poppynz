import { dummySessionResolution, type ConversationMessage } from '@repo/db';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  ADMIN,
  ADMIN_GRANTS,
  CONTRACT_ID,
  CONVERSATION_ID,
  CYCLE_ID,
  SESSION_ID,
  failureOf,
  makeContext,
  makeSessionWorld
} from '../contracts/sessions.test-support';
import {
  decideSessionDisputeRouteProgram,
  getSessionDisputeRouteProgram,
  listSessionDisputesRouteProgram
} from './session-disputes.handler';

const DISPUTE_ID = '0198a3b0-0000-7000-8000-00000000dd01';
const NOW = new Date('2026-11-06T15:00:00.000Z');

const contested = dummySessionResolution({
  id: DISPUTE_ID,
  contractId: CONTRACT_ID,
  sessionId: SESSION_ID,
  cycleId: CYCLE_ID,
  kind: 'helper_no_show',
  reportedByUserId: 'family-1',
  reportedBySide: 'family',
  note: 'Nobody came.',
  status: 'contested',
  response: 'contested',
  respondedByUserId: 'helper-1',
  respondedAt: new Date('2026-11-04T10:00:00.000Z'),
  responseNote: 'I rang the bell at 15:25.',
  policyVersion: 5
});

const message = (id: string, at: string, sender = 'family-1'): ConversationMessage => ({
  id,
  conversationId: CONVERSATION_ID,
  senderUserId: sender,
  body: `message ${id}`,
  deletedAt: null,
  createdAt: new Date(at),
  updatedAt: new Date(at)
});

const adminWorld = (options: Parameters<typeof makeSessionWorld>[0] = {}) =>
  makeSessionWorld({
    viewer: ADMIN,
    grants: ADMIN_GRANTS,
    resolutions: [contested],
    ...options
  });

type World = ReturnType<typeof adminWorld>;

const decide = (world: World, body: unknown) =>
  Effect.runPromiseExit(
    decideSessionDisputeRouteProgram(
      makeContext({ params: { id: DISPUTE_ID }, body }),
      new Headers(),
      NOW
    ).pipe(Effect.provide(world.layer))
  );

describe('GET /admin/session-disputes', () => {
  it('lists contested resolutions with both parties and the session', async () => {
    const world = adminWorld();
    const result = await Effect.runPromise(
      listSessionDisputesRouteProgram(makeContext(), new Headers()).pipe(
        Effect.provide(world.layer)
      )
    );
    expect(result.disputes).toEqual([
      expect.objectContaining({
        id: DISPUTE_ID,
        kind: 'helper_no_show',
        familyName: 'Priya Tester',
        helperName: 'Maria Tester',
        reportedByName: 'Priya Tester',
        respondedByName: 'Maria Tester',
        session: expect.objectContaining({
          date: '2026-11-03',
          startMinutes: 930,
          endMinutes: 1050,
          timeZone: 'America/Toronto'
        })
      })
    ]);
  });

  it('is denied without the dispute permission (403)', async () => {
    const world = adminWorld({ grants: ['sessionResolution:read', 'sessionResolution:write'] });
    const exit = await Effect.runPromiseExit(
      listSessionDisputesRouteProgram(makeContext(), new Headers()).pipe(
        Effect.provide(world.layer)
      )
    );
    expect(failureOf(exit)?._tag).toBe('ForbiddenError');
  });
});

describe('GET /admin/session-disputes/:id', () => {
  it('shows both statements, the messages from 24 h before to 24 h after, the agreement and policy', async () => {
    const world = adminWorld({
      messages: [
        message('too-early', '2026-11-02T20:29:00.000Z'),
        message('day-before', '2026-11-02T20:30:00.000Z'),
        message('after', '2026-11-03T23:00:00.000Z', 'helper-1'),
        message('day-after', '2026-11-04T22:30:00.000Z'),
        message('too-late', '2026-11-04T22:31:00.000Z')
      ]
    });
    const { dispute } = await Effect.runPromise(
      getSessionDisputeRouteProgram(
        makeContext({ params: { id: DISPUTE_ID } }),
        new Headers()
      ).pipe(Effect.provide(world.layer))
    );
    expect(dispute).toMatchObject({
      note: 'Nobody came.',
      responseNote: 'I rang the bell at 15:25.',
      policyVersion: 5,
      session: { serviceName: 'Childcare', timeZoneLabel: 'Eastern Time' }
    });
    expect(dispute.messages.map((row) => [row.id, row.side])).toEqual([
      ['day-before', 'family'],
      ['after', 'helper'],
      ['day-after', 'family']
    ]);
    expect(dispute.agreement.map((row) => [row.side, row.cancellationPolicyVersion])).toEqual([
      ['family', 5],
      ['helper', 5]
    ]);
  });

  it('answers 404 for an unknown dispute', async () => {
    const world = adminWorld({ resolutions: [] });
    const exit = await Effect.runPromiseExit(
      getSessionDisputeRouteProgram(
        makeContext({ params: { id: DISPUTE_ID } }),
        new Headers()
      ).pipe(Effect.provide(world.layer))
    );
    expect(failureOf(exit)?._tag).toBe('SessionDisputeNotFoundError');
  });
});

describe('admin names', () => {
  it('names the deciding admin, never by their user id', async () => {
    const world = adminWorld();
    await decide(world, { decision: 'as_scheduled', reason: 'Seen on camera.' });
    const result = await Effect.runPromise(
      getSessionDisputeRouteProgram(
        makeContext({ params: { id: DISPUTE_ID } }),
        new Headers()
      ).pipe(Effect.provide(world.layer))
    );
    expect(result.dispute.decidedByName).toBe('Ada Tester');
    expect(result.dispute.history.at(-1)?.actorName).toBe('Ada Tester');
    const decided = await Effect.runPromise(
      listSessionDisputesRouteProgram(
        makeContext({ query: { status: 'decided' } }),
        new Headers()
      ).pipe(Effect.provide(world.layer))
    );
    expect(decided.disputes[0]?.decidedByName).toBe('Ada Tester');
  });
});

describe('POST /admin/session-disputes/:id/decide', () => {
  it('decides the dispute, audits who, when, before and after, and tells both parties', async () => {
    const world = adminWorld();
    const exit = await decide(world, {
      decision: 'as_scheduled',
      reason: 'The doorbell camera shows Maria arriving at 15:25.'
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    const [row] = world.resolutions.state.resolutions;
    expect(row).toMatchObject({
      status: 'decided',
      decision: 'as_scheduled',
      decidedByUserId: 'admin-1',
      decidedAt: NOW
    });
    const [event] = world.resolutions.state.events;
    expect(event).toMatchObject({
      action: 'decided',
      actorUserId: 'admin-1',
      actorSide: 'admin',
      fromStatus: 'contested',
      toStatus: 'decided',
      note: 'The doorbell camera shows Maria arriving at 15:25.'
    });
    expect(event?.before).toMatchObject({ status: 'contested', decision: null });
    expect(event?.after).toMatchObject({ status: 'decided', decision: 'as_scheduled' });
    expect(world.mails.map((mail) => [mail.locale, mail.subject])).toEqual([
      ['en', 'Dispute decided for Tue, Nov 3'],
      ['fr', 'Litige tranché (mar. 3 nov.)']
    ]);
    expect(world.mails[0]?.paragraphs[0]).toContain('the session went ahead as scheduled');
    // A second decision is refused.
    expect(failureOf(await decide(world, { decision: 'helper_no_show', reason: 'x' }))?._tag).toBe(
      'SessionDisputeNotOpenError'
    );
  });

  it('requires a reason', async () => {
    const world = adminWorld();
    expect(failureOf(await decide(world, { decision: 'helper_no_show', reason: ' ' }))?._tag).toBe(
      'RequestValidationError'
    );
  });

  it('needs the minutes worked to decide reduced hours', async () => {
    const world = adminWorld();
    expect(
      failureOf(await decide(world, { decision: 'family_reduced_hours', reason: 'Sent home' }))
        ?._tag
    ).toBe('SessionDisputeMinutesError');
    const exit = await decide(world, {
      decision: 'family_reduced_hours',
      reason: 'Sent home early',
      minutesWorked: 60
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(world.resolutions.state.resolutions[0]?.decisionMinutesWorked).toBe(60);
  });

  it('is denied with read-only dispute access (403)', async () => {
    const world = adminWorld({ grants: ['sessionDispute:read'] });
    expect(
      failureOf(await decide(world, { decision: 'helper_no_show', reason: 'Confirmed' }))?._tag
    ).toBe('ForbiddenError');
    expect(world.resolutions.state.events).toEqual([]);
  });

  it('refuses deciding a resolution nobody contested', async () => {
    const world = adminWorld({ resolutions: [{ ...contested, status: 'confirmed' }] });
    expect(
      failureOf(await decide(world, { decision: 'helper_no_show', reason: 'Confirmed' }))?._tag
    ).toBe('SessionDisputeNotOpenError');
  });

  it('maps a database failure to the repo error', async () => {
    const world = adminWorld({ repoDown: true });
    expect(
      failureOf(await decide(world, { decision: 'helper_no_show', reason: 'Confirmed' }))?._tag
    ).toBe('SessionDisputeRepoError');
  });
});
