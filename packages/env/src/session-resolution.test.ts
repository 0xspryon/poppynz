import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Either } from 'effect';
import { contractBillingConfig, sessionResolutionConfig } from './index';

const read = <A>(config: Effect.Effect<A, unknown>, env: Record<string, string>) =>
  Effect.runSync(
    Effect.either(
      config.pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env)))))
    )
  );

describe('session resolution settings', () => {
  it('defaults to a 14-day window, 24 h notice, 48 h response and report windows, 25 %', () => {
    expect(read(sessionResolutionConfig, {})).toEqual(
      Either.right({
        cancellationNoticeHours: 24,
        reportResponseHours: 48,
        reportWindowHours: 48,
        lateCancellationHelperBps: 2500
      })
    );
    const billing = read(contractBillingConfig, {});
    expect(Either.isRight(billing) && billing.right.sessionWindowDays).toBe(14);
  });

  it('reads configured values', () => {
    const result = read(sessionResolutionConfig, {
      CONTRACT_CANCELLATION_NOTICE_HOURS: '12',
      CONTRACT_REPORT_RESPONSE_HOURS: '72',
      CONTRACT_REPORT_WINDOW_HOURS: '24',
      CONTRACT_LATE_CANCELLATION_HELPER_BPS: '3000'
    });
    expect(result).toEqual(
      Either.right({
        cancellationNoticeHours: 12,
        reportResponseHours: 72,
        reportWindowHours: 24,
        lateCancellationHelperBps: 3000
      })
    );
    const billing = read(contractBillingConfig, { CONTRACT_SESSION_WINDOW_DAYS: '21' });
    expect(Either.isRight(billing) && billing.right.sessionWindowDays).toBe(21);
  });

  it.each([
    ['CONTRACT_CANCELLATION_NOTICE_HOURS', '0'],
    ['CONTRACT_CANCELLATION_NOTICE_HOURS', 'soon'],
    ['CONTRACT_REPORT_RESPONSE_HOURS', '-1'],
    ['CONTRACT_REPORT_WINDOW_HOURS', '1000'],
    ['CONTRACT_LATE_CANCELLATION_HELPER_BPS', '10001'],
    ['CONTRACT_LATE_CANCELLATION_HELPER_BPS', '2.5']
  ])('fails loudly on %s=%s', (name, value) => {
    expect(Either.isLeft(read(sessionResolutionConfig, { [name]: value }))).toBe(true);
  });

  it.each(['0', '61', 'two weeks'])('fails loudly on CONTRACT_SESSION_WINDOW_DAYS=%s', (value) => {
    expect(
      Either.isLeft(read(contractBillingConfig, { CONTRACT_SESSION_WINDOW_DAYS: value }))
    ).toBe(true);
  });
});
