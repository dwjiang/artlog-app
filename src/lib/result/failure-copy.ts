import { isNetworkError } from '@/lib/network-error';

const CAPTURE_CODES = new Set(['bad_features', 'bad_vector', 'bad_dimension', 'bad_descriptors', 'bad_candidates']);
const SESSION_CODES = new Set(['unauthenticated', 'device_not_registered', 'device_not_attested']);

export const FAILED_TITLE = 'Identification failed.';

/** Product voice for a scan the server could not identify; error codes and transport messages never reach the card raw. */
export function failureCopy(error?: string | null): string {
  if (!error) return 'Something went wrong while identifying this painting.';
  if (CAPTURE_CODES.has(error)) return 'The photo couldn’t be read. Try scanning the painting again.';
  if (SESSION_CODES.has(error)) return 'This phone isn’t set up to identify yet. Try again in a moment.';
  if (error === 'rate_limited' || error === 'ratelimited') return 'Too many scans right now. Try again in a minute.';
  if (error === 'device_banned') return 'This phone can’t identify paintings.';
  // `not_found` is the server's answer for a visit this journal does not own.
  if (error === 'invalid_visit' || error === 'invalid_venue' || error === 'not_found') return 'The museum for this scan couldn’t be confirmed.';
  if (error === 'scan_not_found' || error === 'invalid_scan') return 'The server no longer has this scan.';
  if (error.includes('ArgumentValidationError')) return 'This scan link is invalid or no longer available.';
  if (error === 'Identification interrupted') return 'Identification was interrupted before the server answered.';
  if (isNetworkError(new Error(error))) return 'The connection dropped before the server answered.';
  return 'Something went wrong while identifying this painting.';
}
