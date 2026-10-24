import { describe, expect, it } from 'vitest';
import { detectContactDetails } from './contact-details';

describe('detectContactDetails', () => {
  it.each([
    ['Call me on 416-555-0123', ['phone']],
    ['my cell is (647) 555 0199', ['phone']],
    ['+1 204 555 0100 anytime', ['phone']],
    ['email kay.test@example.com', ['email']],
    ['see https://example.org/me', ['link']],
    ['www.mysite.ca has my CV', ['link']],
    ['find me at janedoe.com', ['link']]
  ])('flags %s', (body, kinds) => {
    expect(detectContactDetails(body)).toEqual(kinds);
  });

  it('flags several kinds at once and does not count an email domain as a link', () => {
    expect(detectContactDetails('a@b.com or 416 555 0123')).toEqual(['phone', 'email']);
  });

  it.each([
    'See you Monday at 3:30!',
    'The rate is $25.00/hr for 2 kids',
    'Sessions on 2026-10-19 and 2026-10-26',
    'Postal code M5H 2N2'
  ])('leaves ordinary text alone: %s', (body) => {
    expect(detectContactDetails(body)).toEqual([]);
  });
});
