import { describe, expect, it } from 'bun:test';
import { zoneForLocation } from './lookup';

describe('zoneForLocation', () => {
  it.each([
    ['Winnipeg', 49.8951, -97.1384, 'America/Winnipeg'],
    ['Regina (no DST)', 50.4452, -104.6189, 'America/Regina'],
    ['Kenora (Central, in Ontario)', 49.767, -94.4894, 'America/Winnipeg'],
    ['Cranbrook (Mountain, in BC)', 49.512, -115.7694, 'America/Edmonton'],
    ['Toronto', 43.6532, -79.3832, 'America/Toronto'],
    ['Vancouver', 49.2827, -123.1207, 'America/Vancouver'],
    ["St. John's", 47.5615, -52.7126, 'America/St_Johns']
  ])('%s', (_name, latitude, longitude, zone) => {
    expect(zoneForLocation(latitude, longitude)).toBe(zone);
  });

  it('returns null for impossible coordinates instead of throwing', () => {
    expect(zoneForLocation(200, 0)).toBeNull();
  });
});
