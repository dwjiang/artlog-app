import { useConvexAuth, useQueries, type RequestForQueries } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { useMemo } from 'react';

import { api } from '../../convex/_generated/api';

/** True once the anonymous session is signed in and the device row exists, so `requireDevice` queries can run. */
export function useDeviceReady(): boolean {
  const { isAuthenticated } = useConvexAuth();
  const deviceQuery = useMemo(
    (): RequestForQueries => isAuthenticated ? { device: { query: api.devices.me, args: {} } } : {},
    [isAuthenticated],
  );
  const { device }: { device?: FunctionReturnType<typeof api.devices.me> | Error } = useQueries(deviceQuery);
  return isAuthenticated && !!device && !(device instanceof Error);
}
