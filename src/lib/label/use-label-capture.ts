import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { captureQuery } from '@/db/repos/pending-scans';

export function useLabelCapture(scanId: string) {
  const { data } = useLiveQuery(captureQuery(scanId), [scanId]);
  return data[0];
}
