import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Either } from 'effect';
import { cardDisputeConfig } from './index';

const read = <A>(config: Effect.Effect<A, unknown>, env: Record<string, string>) =>
  Effect.runSync(
    Effect.either(
      config.pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env)))))
    )
  );

describe('card dispute settings', () => {
  it('defaults to a 72 h evidence reminder and 14 days / 60 messages of excerpts', () => {
    expect(read(cardDisputeConfig, {})).toEqual(
      Either.right({ evidenceReminderHours: 72, evidenceMessageDays: 14, evidenceMaxMessages: 60 })
    );
  });

  it('reads configured values', () => {
    expect(
      read(cardDisputeConfig, {
        CONTRACT_DISPUTE_EVIDENCE_REMINDER_HOURS: '48',
        CONTRACT_DISPUTE_EVIDENCE_MESSAGE_DAYS: '30',
        CONTRACT_DISPUTE_EVIDENCE_MAX_MESSAGES: '20'
      })
    ).toEqual(
      Either.right({ evidenceReminderHours: 48, evidenceMessageDays: 30, evidenceMaxMessages: 20 })
    );
  });

  it.each([
    ['CONTRACT_DISPUTE_EVIDENCE_REMINDER_HOURS', '0'],
    ['CONTRACT_DISPUTE_EVIDENCE_REMINDER_HOURS', '721'],
    ['CONTRACT_DISPUTE_EVIDENCE_REMINDER_HOURS', 'three days'],
    ['CONTRACT_DISPUTE_EVIDENCE_MESSAGE_DAYS', '0'],
    ['CONTRACT_DISPUTE_EVIDENCE_MESSAGE_DAYS', '1.5'],
    ['CONTRACT_DISPUTE_EVIDENCE_MAX_MESSAGES', '501']
  ])('fails loudly on %s=%s', (name, value) => {
    expect(Either.isLeft(read(cardDisputeConfig, { [name]: value }))).toBe(true);
  });
});
