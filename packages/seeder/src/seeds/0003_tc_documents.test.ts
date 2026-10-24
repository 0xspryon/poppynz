import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';

describe('0003 seeded Terms of Service', () => {
  it('does not publish the off-platform clause 27.7 pending legal review', async () => {
    const terms = await readFile(
      new URL('./content/terms_of_service.md', import.meta.url),
      'utf8'
    );
    expect(terms).not.toContain('27.7');
    expect(terms).not.toContain('PENDING LEGAL REVIEW');
    expect(terms).toContain('**27.6**');
  });
});
