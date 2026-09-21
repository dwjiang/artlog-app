import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ScanResult } from '@/lib/result/state';
import { useMuseumSearchConsent } from '@/lib/settings/use-museum-search-consent';
import { museumSearchMessage, type MuseumSearchOutcome, type MuseumSearchStage } from './flow';
import { runMuseumSearchForScan } from './museum-search-deps';
import { restoreConfirmedMuseumFlow } from './restore';

type Phase = MuseumSearchOutcome | { stage: 'idle' } | { stage: 'restore-error' } | { stage: 'running'; progress: MuseumSearchStage };

export function useMuseumSearch(scan: ScanResult | undefined, active: boolean) {
  const { consent } = useMuseumSearchConsent(active);
  const network = useNetworkState();
  const online = network.isInternetReachable === true;
  const [phase, setPhase] = useState<Phase>({ stage: 'idle' });
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const inFlight = useRef(false);
  const attempted = useRef(false);
  const mounted = useRef(false);
  const canRun = useRef(false);
  const stored = scan?.museumSearch;
  const automatic = scan?.best?.identityStatus !== 'tentative';
  const available = scan?.status === 'identified' && scan.outcome !== 'confident' && !!scan.venueId;
  useLayoutEffect(() => { canRun.current = active && online && available; }, [active, online, available]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; canRun.current = false; };
  }, []);

  const run = useCallback(async () => {
    if (!scan || !canRun.current || inFlight.current || stored?.stage === 'confirmed') return;
    inFlight.current = true;
    attempted.current = true;
    setPhase({ stage: 'running', progress: stored?.stage === 'candidates' || stored?.stage === 'exhibitions' ? 'check' : 'exhibitions' });
    try {
      const result = await runMuseumSearchForScan({
        scanId: scan.scanId, localId: scan.localId,
        stored: stored?.stage === 'candidates' || stored?.stage === 'exhibitions' ? stored : undefined,
        canContinue: () => mounted.current && canRun.current,
        onStage: (progress) => { if (mounted.current) setPhase({ stage: 'running', progress }); },
      });
      if (mounted.current) setPhase(result);
      if (result.stage === 'cancelled') attempted.current = false;
    } catch {
      if (mounted.current) setPhase({ stage: 'none', reason: 'network' });
    } finally {
      inFlight.current = false;
    }
  }, [scan, stored]);

  useEffect(() => {
    if (automatic && phase.stage !== 'running' && available && active && online && consent === 'granted' && !attempted.current &&
      (!stored || stored.stage === 'candidates' || stored.stage === 'exhibitions')) void run();
  }, [automatic, available, active, online, consent, stored, run, phase.stage]);

  useEffect(() => {
    if (!scan || stored?.stage !== 'confirmed') return;
    let current = true;
    void restoreConfirmedMuseumFlow(scan).then(
      (flow) => {
        if (!current) return;
        setPhase((previous) => {
          if (!flow) return { stage: 'none', reason: 'model_error' };
          if (previous.stage === 'done' && previous.confirmedAt === stored.updatedAt) return previous;
          return { stage: 'done', flow, confirmedAt: stored.updatedAt };
        });
      },
      () => { if (current) setPhase({ stage: 'restore-error' }); },
    );
    return () => { current = false; };
  }, [scan, stored, restoreAttempt]);

  // Keep the accepted result as the review's edit baseline; sharing re-verifies labelFlow in place.
  const flow = phase.stage === 'done' ? phase.flow : undefined;
  const restoring = stored?.stage === 'confirmed' && phase.stage === 'idle';
  const restoreError = phase.stage === 'restore-error';
  const reason = phase.stage === 'none' ? phase.reason : stored?.stage === 'none' ? stored.reason
    : stored?.stage === 'confirmed' && !flow ? 'model_error' : undefined;
  const hidden = reason !== undefined && museumSearchMessage(reason) === undefined;

  return {
    flow: available ? flow : undefined,
    confirmedAt: phase.stage === 'done' ? phase.confirmedAt : undefined,
    restoring,
    restoreError,
    retryRestore: () => { setPhase({ stage: 'idle' }); setRestoreAttempt((attempt) => attempt + 1); },
    running: phase.stage === 'running' && !flow,
    progress: phase.stage === 'running' ? phase.progress : undefined,
    message: reason === undefined ? undefined : museumSearchMessage(reason),
    visible: available && !hidden && (consent !== 'declined' || !!flow || restoring || restoreError),
  };
}

export type MuseumSearchController = ReturnType<typeof useMuseumSearch>;
