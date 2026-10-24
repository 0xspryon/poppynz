import { describe, expect, it } from 'bun:test';
import { seedsDevAccountant } from './0006_dev_accountant';

describe('0006_dev_accountant', () => {
  it('seeds the accountant on a local dev stack only', () => {
    expect(seedsDevAccountant('dev', undefined)).toBe(true);
    expect(seedsDevAccountant('dev', 'production')).toBe(false);
    expect(seedsDevAccountant('staging', undefined)).toBe(false);
    expect(seedsDevAccountant('production', undefined)).toBe(false);
  });
});
