import { useQueries, type RequestForQueries } from 'convex/react';
import { useMemo } from 'react';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useDeviceReady } from '@/lib/use-device-ready';
import type { ScanResult } from './state';

/** The live scan document; `undefined` until the device can query, an `Error` when the server refuses it. */
export function useScan(scanId: Id<'scans'> | undefined): ScanResult | Error | undefined {
  const ready = useDeviceReady();
  const query = useMemo(
    (): RequestForQueries => ready && scanId ? { scan: { query: api.scans.get, args: { scanId } } } : {},
    [ready, scanId],
  );
  const { scan }: { scan?: ScanResult | Error } = useQueries(query);
  return scan;
}
