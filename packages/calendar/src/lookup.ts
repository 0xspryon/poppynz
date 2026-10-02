import tzlookup from '@photostructure/tz-lookup';

/**
 * Server-only: the IANA zone for a point, from boundary data bundled with the
 * library (no network). Province alone is not enough — Ontario, BC, Quebec and
 * Labrador each span two zones and Saskatchewan has no DST. Null for
 * coordinates the library rejects.
 */
export const zoneForLocation = (latitude: number, longitude: number): string | null => {
  try {
    return tzlookup(latitude, longitude);
  } catch {
    return null;
  }
};
