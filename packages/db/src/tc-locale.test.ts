import { describe, expect, it } from 'bun:test';
import {
  currentRevision,
  currentRevisionRow,
  displayedVersion,
  nextDraftVersion,
  toTcLocale
} from './tc-locale';

const at = new Date('2026-10-01T00:00:00.000Z');
const row = (id: string, locale: string, version: number, published = true) => ({
  id,
  locale,
  version,
  publishedAt: published ? at : null
});

describe('per-locale terms (U7)', () => {
  const versions = [
    row('en-1', 'en', 1),
    row('fr-1', 'fr', 1),
    row('en-2', 'en', 2),
    row('en-3', 'en', 3, false)
  ];

  it('numbers revisions by the latest published English version', () => {
    expect(currentRevision(versions)?.id).toBe('en-2');
    expect(currentRevision([row('fr-1', 'fr', 1)])).toBeNull();
  });

  it('shows the translation of the current revision, else English with a fallback flag', () => {
    expect(displayedVersion(versions, 'en')).toEqual({ version: versions[2], fallback: false });
    // French exists only for revision 1: out of date, so English shows.
    expect(displayedVersion(versions, 'fr')).toEqual({ version: versions[2], fallback: true });
    const translated = [...versions, row('fr-2', 'fr', 2)];
    expect(displayedVersion(translated, 'fr')?.version.id).toBe('fr-2');
    expect(displayedVersion(translated, 'fr')?.fallback).toBe(false);
    // An unpublished translation never shows.
    expect(displayedVersion([...versions, row('fr-2', 'fr', 2, false)], 'fr')?.fallback).toBe(true);
  });

  it('accepts either locale of the current revision, nothing older or unpublished', () => {
    const translated = [...versions, row('fr-2', 'fr', 2)];
    expect(currentRevisionRow(translated, 'en-2')?.id).toBe('en-2');
    expect(currentRevisionRow(translated, 'fr-2')?.id).toBe('fr-2');
    expect(currentRevisionRow(translated, 'fr-1')).toBeNull();
    expect(currentRevisionRow(translated, 'en-3')).toBeNull();
  });

  it('opens English drafts as the next revision and translations of the latest English', () => {
    expect(nextDraftVersion(versions, 'en')).toBe(4);
    expect(nextDraftVersion(versions, 'fr')).toBe(3);
    expect(nextDraftVersion([], 'en')).toBe(1);
    expect(nextDraftVersion([], 'fr')).toBeNull();
  });

  it('reads unknown locales as English', () => {
    expect(toTcLocale('fr')).toBe('fr');
    expect(toTcLocale('de')).toBe('en');
    expect(toTcLocale(undefined)).toBe('en');
  });
});
