import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Migration hygiene (CI runs `bun test src` here).
 *
 * drizzle's migrator applies a journal entry only when its `when` is greater
 * than the `created_at` of the newest migration already applied — NOT by tag
 * and NOT "any missing file". A new migration whose `when` is lower than one
 * already applied is skipped silently on every database that has it. So:
 * every new entry's `when` must exceed the current maximum.
 */

const migrations = join(import.meta.dir, 'migrations');

type JournalEntry = { idx: number; version: string; when: number; tag: string };

const journal = JSON.parse(readFileSync(join(migrations, 'meta', '_journal.json'), 'utf8')) as {
  entries: Array<JournalEntry>;
};

const numberOf = (tag: string) => Number(/^(\d{4})_/.exec(tag)?.[1] ?? Number.NaN);

describe('migration journal', () => {
  const entries = journal.entries;

  it('has contiguous idx values from 0', () => {
    expect(entries.map((entry) => entry.idx)).toEqual(entries.map((_, index) => index));
  });

  it('has strictly increasing `when` values (drizzle skips anything older than the newest applied)', () => {
    const outOfOrder = entries.filter(
      (entry, index) => index > 0 && entry.when <= entries[index - 1]!.when
    );
    expect(outOfOrder.map((entry) => entry.tag)).toEqual([]);
  });

  it('has a numbered tag on every entry, in increasing number order', () => {
    const numbers = entries.map((entry) => numberOf(entry.tag));
    expect(numbers.every(Number.isInteger)).toBe(true);
    const outOfOrder = entries.filter(
      (entry, index) => index > 0 && numbers[index]! <= numbers[index - 1]!
    );
    expect(outOfOrder.map((entry) => entry.tag)).toEqual([]);
  });

  it('has a .sql file for every entry', () => {
    const missing = entries.filter((entry) => !existsSync(join(migrations, `${entry.tag}.sql`)));
    expect(missing.map((entry) => entry.tag)).toEqual([]);
  });

  it('has a journal entry for every .sql file', () => {
    const tags = new Set(entries.map((entry) => entry.tag));
    const orphans = readdirSync(migrations)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.slice(0, -'.sql'.length))
      .filter((tag) => !tags.has(tag));
    expect(orphans).toEqual([]);
  });
});

describe('drizzle config', () => {
  it('never prints the database URL (it carries the password)', () => {
    const config = readFileSync(join(import.meta.dir, '..', 'drizzle.config.ts'), 'utf8');
    expect(config).not.toMatch(/console\.\w+\(/);
  });
});
