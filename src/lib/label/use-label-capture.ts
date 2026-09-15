import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { useLocalOwner } from '@/lib/account/owner-store';
import { captureQuery } from '@/db/repos/pending-scans';

export function useLabelCapture(scanId: string) {
  const owner = useLocalOwner();
  const { data } = useLiveQuery(captureQuery(scanId, owner), [scanId, owner]);
  return data.find((row) => row.owner === owner);
}
