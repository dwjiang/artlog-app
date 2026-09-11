import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { LabelFlowDisplay } from '../../../convex/lib/validators';
import type { ScanResult } from '@/lib/result/state';
import { getMuseumSearchConsent } from '@/lib/settings/museum-search';
import { useMuseumSearchConsent } from '@/lib/settings/use-museum-search-consent';
import { museumSearchMessage, type MuseumSearchOutcome, type MuseumSearchStage } from './flow';
import { runMuseumSearchForScan } from './museum-search-deps';

type Phase = MuseumSearchOutcome | { stage: 'idle' } | { stage: 'running'; progress: MuseumSearchStage };

export function useMuseumSearch(scan: ScanResult | undefined, eligible: boolean, active: boolean) {
  const consent = useMuseumSearchConsent(active);
  const network = useNetworkState();
  const online = network.isInternetReachable === true;
  const [phase, setPhase] = useState<Phase>({ stage: 'idle' });
  const [consentOpen, setConsentOpen] = useState(false);
  const inFlight = useRef(false);
  const attempted = useRef(false);
  const mounted = useRef(false);
  const canRun = useRef(false);
  const stored = scan?.museumSearch;
  const available = eligible && !!scan?.venueId;
  useLayoutEffect(() => { canRun.current = active && online && available; }, [active, online, available]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; canRun.current = false; };
  }, []);

  const run = useCallback(async (retry = false) => {
    if (!scan || !canRun.current || inFlight.current || stored?.stage === 'confirmed') return;
    inFlight.current = true;
    attempted.current = true;
    setPhase({ stage: 'running', progress: stored?.stage === 'candidates' ? 'check' : 'describe' });
    try {
      const result = await runMuseumSearchForScan({
        scanId: scan.scanId, localId: scan.localId,
        retry,
        stored: stored?.stage === 'candidates' ? stored : undefined,
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
    if (phase.stage !== 'running' && available && active && online && consent === 'granted' && !attempted.current &&
      (!stored || stored.stage === 'candidates')) void run();
  }, [available, active, online, consent, stored, run, phase.stage]);

  async function requestSearch() {
    if (!canRun.current || inFlight.current) return;
    const current = await getMuseumSearchConsent().catch(() => undefined);
    if (!mounted.current || !canRun.current) return;
    if (current === 'unset') setConsentOpen(true);
    if (current === 'granted') void run(true);
  }

  let flow: LabelFlowDisplay | undefined;
  if (stored?.stage === 'confirmed' && scan?.labelFlow?.stage === 'verified' &&
    scan.labelFlow.moderation === 'clear' && scan.labelFlow.sourceUrl === stored.selected.sourceUrl) flow = scan.labelFlow;
  // The action result only bridges the interval before the public subscription receives the confirmation.
  if (!flow && stored?.stage !== 'confirmed' && phase.stage === 'done') flow = phase.flow;
  const reason = phase.stage === 'none' ? phase.reason : stored?.stage === 'none' ? stored.reason
    : stored?.stage === 'confirmed' && !flow ? 'model_error' : undefined;
  const hidden = reason !== undefined && museumSearchMessage(reason) === undefined;

  return {
    flow: available ? flow : undefined,
    running: phase.stage === 'running' && !flow,
    progress: phase.stage === 'running' ? phase.progress : undefined,
    message: reason === undefined ? undefined : museumSearchMessage(reason),
    visible: available && !hidden && (consent !== 'declined' || !!flow),
    canSearch: consent !== undefined && consent !== 'declined' && online && active && stored?.stage !== 'confirmed',
    consentOpen,
    requestSearch: () => { void requestSearch(); },
    dismissConsent: () => setConsentOpen(false),
    acceptConsent: () => { setConsentOpen(false); void run(true); },
  };
}

export type MuseumSearchController = ReturnType<typeof useMuseumSearch>;
