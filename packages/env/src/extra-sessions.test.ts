import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Either } from 'effect';
import { extraSessionConfig } from './index';

const read = <A>(config: Effect.Effect<A, unknown>, env: Record<string, string>) =>
  Effect.runSync(
    Effect.either(
      config.pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env)))))
    )
  );

describe('extra session settings', () => {
  it('defaults to 14 days back, a 60-minute delay, a 7-day unpaid alert', () => {
    expect(read(extraSessionConfig, {})).toEqual(
      Either.right({
        lookbackDays: 14,
        chargeDelayMinutes: 60,
        unpaidAlertDays: 7,
        maxChargeAttempts: 15,
        minMinutes: 15
      })
    );
  });

  it('reads configured values', () => {
    expect(
      read(extraSessionConfig, {
        CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS: '7',
        CONTRACT_EXTRA_SESSION_CHARGE_DELAY_MINUTES: '0',
        CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS: '3',
        CONTRACT_EXTRA_SESSION_MAX_CHARGE_ATTEMPTS: '4',
        CONTRACT_EXTRA_SESSION_MIN_MINUTES: '30'
      })
    ).toEqual(
      Either.right({
        lookbackDays: 7,
        chargeDelayMinutes: 0,
        unpaidAlertDays: 3,
        maxChargeAttempts: 4,
        minMinutes: 30
      })
    );
  });

  it.each([
    ['CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS', '-1'],
    ['CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS', '61'],
    ['CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS', 'two weeks'],
    ['CONTRACT_EXTRA_SESSION_CHARGE_DELAY_MINUTES', '1441'],
    ['CONTRACT_EXTRA_SESSION_CHARGE_DELAY_MINUTES', '1.5'],
    ['CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS', '0'],
    ['CONTRACT_EXTRA_SESSION_MAX_CHARGE_ATTEMPTS', '0'],
    ['CONTRACT_EXTRA_SESSION_MIN_MINUTES', '0']
  ])('fails loudly on %s=%s', (name, value) => {
    expect(Either.isLeft(read(extraSessionConfig, { [name]: value }))).toBe(true);
  });
});
