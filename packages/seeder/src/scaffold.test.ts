import { describe, expect, it } from 'bun:test';
import {
  nextSeedNumber,
  normalizeDescription,
  registerInIndex,
  seedFileTemplate,
  toIdentifier
} from './scaffold';

describe('normalizeDescription', () => {
  it('snake_cases spaces, dashes and case', () => {
    expect(normalizeDescription('Default Document-Types')).toBe('default_document_types');
  });

  it('rejects invalid characters', () => {
    expect(() => normalizeDescription('nope!')).toThrow('Invalid seed description');
  });

  it('rejects a leading digit', () => {
    expect(() => normalizeDescription('0abc')).toThrow('Invalid seed description');
  });
});

describe('nextSeedNumber', () => {
  it('starts at 0000 with no seed files', () => {
    expect(nextSeedNumber(['index.ts'])).toBe('0000');
  });

  it('increments the highest existing prefix', () => {
    expect(nextSeedNumber(['0000_admin_users.ts', '0002_gap.ts', 'index.ts'])).toBe('0003');
  });
});

describe('toIdentifier', () => {
  it('camelCases a snake_case description', () => {
    expect(toIdentifier('default_document_types')).toBe('defaultDocumentTypes');
  });
});

describe('registerInIndex', () => {
  const source = [
    'import type { Seed } from "../types";',
    'import { adminUsers } from "./0000_admin_users";',
    '// <seed:new-imports> — keep.',
    '',
    'export const seeds: ReadonlyArray<Seed> = [',
    '  adminUsers,',
    '  // <seed:new-entries> — keep.',
    '];'
  ].join('\n');

  it('inserts the import and the array entry before the markers', () => {
    const updated = registerInIndex(source, 'docTypes', '0001_doc_types');
    expect(updated).toContain(
      'import { docTypes } from "./0001_doc_types";\n// <seed:new-imports>'
    );
    expect(updated).toContain('docTypes,\n  // <seed:new-entries>');
  });

  it('throws when the markers are missing', () => {
    expect(() => registerInIndex('export const seeds = [];', 'x', '0001_x')).toThrow(
      'marker comments'
    );
  });
});

describe('seedFileTemplate', () => {
  it('produces a seed that throws until implemented', () => {
    const content = seedFileTemplate('0001_doc_types', 'docTypes');
    expect(content).toContain('name: "0001_doc_types"');
    expect(content).toContain('export const docTypes: Seed');
    expect(content).toContain('is not implemented yet');
  });
});
