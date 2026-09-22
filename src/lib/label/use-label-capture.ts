import { reportError } from '@/lib/observability';
import { useEffect } from 'react';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { useLocalOwner } from '@/lib/account/owner-store';
import { captureQuery } from '@/db/repos/pending-scans';

export function useLabelCapture(scanId: string) {
  const owner = useLocalOwner();
  const { data, error } = useLiveQuery(captureQuery(scanId, owner), [scanId, owner]);
  useEffect(() => { if (error) reportError(error, 'label.load_capture'); }, [error]);
  return data.find((row) => row.owner === owner);
}
