import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Either } from 'effect';
import { reconciliationConfig } from './index';

const read = <A>(config: Effect.Effect<A, unknown>, env: Record<string, string>) =>
  Effect.runSync(
    Effect.either(
      config.pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env)))))
    )
  );

describe('reconciliation settings', () => {
  it('defaults to a daily run over 35 days, 93-day on-demand ranges, pages of 100', () => {
    expect(read(reconciliationConfig, {})).toEqual(
      Either.right({
        intervalHours: 24,
        lookbackDays: 35,
        maxRangeDays: 93,
        pageSize: 100,
        maxPages: 200
      })
    );
  });

  it('reads configured values', () => {
    expect(
      read(reconciliationConfig, {
        RECONCILIATION_INTERVAL_HOURS: '6',
        RECONCILIATION_LOOKBACK_DAYS: '10',
        RECONCILIATION_MAX_RANGE_DAYS: '31',
        RECONCILIATION_PAGE_SIZE: '25',
        RECONCILIATION_MAX_PAGES: '4'
      })
    ).toEqual(
      Either.right({ intervalHours: 6, lookbackDays: 10, maxRangeDays: 31, pageSize: 25, maxPages: 4 })
    );
  });

  it.each([
    ['RECONCILIATION_INTERVAL_HOURS', '0'],
    ['RECONCILIATION_INTERVAL_HOURS', '169'],
    ['RECONCILIATION_INTERVAL_HOURS', 'daily'],
    ['RECONCILIATION_LOOKBACK_DAYS', '0'],
    ['RECONCILIATION_LOOKBACK_DAYS', '121'],
    ['RECONCILIATION_MAX_RANGE_DAYS', '401'],
    ['RECONCILIATION_PAGE_SIZE', '101'],
    ['RECONCILIATION_MAX_PAGES', '0'],
    ['RECONCILIATION_LOOKBACK_DAYS', '1.5']
  ])('fails loudly on %s=%s', (name, value) => {
    expect(Either.isLeft(read(reconciliationConfig, { [name]: value }))).toBe(true);
  });
});
