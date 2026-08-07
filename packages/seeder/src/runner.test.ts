import { describe, expect, it } from 'bun:test';
import { selectPending } from './runner';
import type { Seed } from './types';

const seed = (name: string): Seed => ({ name, run: async () => {} });

describe('selectPending', () => {
  it('returns unapplied seeds in registry order', () => {
    const all = [seed('0000_a'), seed('0001_b'), seed('0002_c')];
    const pending = selectPending(all, new Set(['0001_b']));
    expect(pending.map((s) => s.name)).toEqual(['0000_a', '0002_c']);
  });

  it('returns nothing when everything is applied', () => {
    const all = [seed('0000_a')];
    expect(selectPending(all, new Set(['0000_a']))).toEqual([]);
  });

  it('throws on duplicate seed names', () => {
    const all = [seed('0000_a'), seed('0000_a')];
    expect(() => selectPending(all, new Set())).toThrow('Duplicate seed name: 0000_a');
  });
});
