import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Either } from 'effect';
import { sessionMoneyConfig } from './index';

const read = <A>(config: Effect.Effect<A, unknown>, env: Record<string, string>) =>
  Effect.runSync(
    Effect.either(
      config.pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env)))))
    )
  );

describe('session money settings', () => {
  it('defaults to a 48 h transfer delay, 60 days to the manual queue, 8 refund attempts', () => {
    expect(read(sessionMoneyConfig, {})).toEqual(
      Either.right({ transferDelayHours: 48, manualPayoutAfterDays: 60, refundAlertAfterAttempts: 8 })
    );
  });

  it('reads configured values', () => {
    expect(
      read(sessionMoneyConfig, {
        CONTRACT_TRANSFER_DELAY_HOURS: '72',
        CONTRACT_MANUAL_PAYOUT_AFTER_DAYS: '30',
        CONTRACT_REFUND_ALERT_AFTER_ATTEMPTS: '3'
      })
    ).toEqual(
      Either.right({ transferDelayHours: 72, manualPayoutAfterDays: 30, refundAlertAfterAttempts: 3 })
    );
  });

  it.each([
    ['CONTRACT_TRANSFER_DELAY_HOURS', '-1'],
    ['CONTRACT_TRANSFER_DELAY_HOURS', '337'],
    ['CONTRACT_TRANSFER_DELAY_HOURS', 'two days'],
    ['CONTRACT_MANUAL_PAYOUT_AFTER_DAYS', '0'],
    ['CONTRACT_MANUAL_PAYOUT_AFTER_DAYS', '366'],
    ['CONTRACT_MANUAL_PAYOUT_AFTER_DAYS', '1.5'],
    ['CONTRACT_REFUND_ALERT_AFTER_ATTEMPTS', '0']
  ])('fails loudly on %s=%s', (name, value) => {
    expect(Either.isLeft(read(sessionMoneyConfig, { [name]: value }))).toBe(true);
  });
});
