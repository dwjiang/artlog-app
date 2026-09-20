import { getVisit } from '@/db/repos/visits';
import { useAction } from 'convex/react';
import * as Haptics from 'expo-haptics';
import type { ImageRef } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useNetworkState } from 'expo-network';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

import { captureOwner, subscribeOwnerChange } from '@/lib/account/owner-store';
import { api } from '../../../convex/_generated/api';
import { venueIdAt } from '@/lib/venue/venue-db';
import { resolveVenueForScan } from '@/lib/venue/use-venue';
import { resolveScanVisit } from '@/lib/venue/visit-sync';
import { CaptureController, type CaptureAttempt } from './capture-controller';
import { captureOptions, defaultStages } from './default-stages';
import { extractCaptureMeta } from './exif';
import { runCapture } from './pipeline';
import { PresentationImages } from './presentation-images';
import type { CaptureInput, CaptureResult, CaptureTimings, PreparedPainting } from './stages';

export type CapturePresentation = {
  attempt: CaptureAttempt;
  photoUri: string;
  source: CaptureInput['source'];
  photo?: ImageRef;
  painting?: PreparedPainting;
  crop?: ImageRef;
};
type Completed = { attempt: CaptureAttempt; result: Exclude<CaptureResult, { kind: 'retake' }> };
type VenueContext = Pick<CaptureInput, 'venueId' | 'visitId' | 'visitLocalId'>;

/** `visitLocalId` pins every capture to that visit; `onVisitUnavailable` runs when it no longer exists so the caller can drop it. */
export function useCapture({ active = true, focused = true, visitLocalId, onVisitUnavailable }: {
  active?: boolean; focused?: boolean; visitLocalId?: string; onVisitUnavailable?: () => void;
} = {}) {
  const identify = useAction(api.identify.identify);
  const network = useNetworkState();
  const online = useRef(network.isInternetReachable);
  useEffect(() => { online.current = network.isInternetReachable; }, [network.isInternetReachable]);
  const router = useRouter();
  const navigation = useRef(router);
  useEffect(() => { navigation.current = router; }, [router]);
  const controller = useMemo(() => new CaptureController(), []);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const mounted = useRef(true);
  const images = useRef<PresentationImages | undefined>(undefined);
  const pendingResult = useRef<Completed | undefined>(undefined);
  const revealFinished = useRef(false);
  const [presentation, setPresentation] = useState<CapturePresentation>();
  const [timings, setTimings] = useState<CaptureTimings>();

  const releasePresentation = useCallback(() => {
    images.current?.release();
    images.current = undefined;
    if (mounted.current) setPresentation(undefined);
  }, []);

  const reset = useCallback(() => {
    controller.reset();
    pendingResult.current = undefined;
    revealFinished.current = false;
    releasePresentation();
  }, [controller, releasePresentation]);

  const navigate = useCallback(() => {
    const pending = pendingResult.current;
    if (!mounted.current || !pending || !revealFinished.current || !controller.result(pending.attempt)) return;
    pendingResult.current = undefined;
    navigation.current.push({
      pathname: '/result/[scanId]',
      params: { scanId: pending.result.kind === 'sent' ? pending.result.scanId : `local-${pending.result.localId}`, entrance: 'capture' },
    });
    // Keep the frozen artwork until the native transition takes focus away from Scan.
  }, [controller]);

  const completeReveal = useCallback((attempt: CaptureAttempt) => {
    if (!attempt.valid) return;
    revealFinished.current = true;
    navigate();
  }, [navigate]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeOwnerChange(reset);
    return () => { mounted.current = false; unsubscribe(); reset(); };
  }, [reset]);

  useEffect(() => {
    controller.setActive(active && focused);
    if (!focused && controller.getSnapshot().phase !== 'result') reset();
    else if (active) navigate();
  }, [active, focused, controller, navigate, reset]);

  const endResultTransition = useCallback(() => {
    if (controller.getSnapshot().phase === 'result') reset();
  }, [controller, reset]);

  async function capture(
    getInput: () => Promise<CaptureInput | null>,
    attempt = controller.begin('camera'),
    resolveContext?: (input: CaptureInput) => Promise<VenueContext>,
    onCancel?: () => void,
  ) {
    if (!attempt) return;
    const owner = captureOwner();
    const current = () => mounted.current && attempt.valid && owner.isOwnerCurrent();
    releasePresentation();
    revealFinished.current = false;
    pendingResult.current = undefined;
    setTimings(undefined);
    try {
      // A chosen visit is checked before the photo is taken, so a missing one costs no shutter press.
      let chosen: VenueContext | undefined;
      if (visitLocalId) {
        const visit = await getVisit(visitLocalId, owner.owner);
        if (!current()) return;
        if (!visit) { onVisitUnavailable?.(); throw new Error('This visit is no longer available. Scan again to continue without it.'); }
        chosen = { visitLocalId: visit.localId, venueId: visit.venueId, visitId: visit.remoteVisitId ?? undefined };
      }
      const input = await getInput();
      if (!current()) return;
      if (!input) { (onCancel ?? reset)(); return; }
      controller.processing(attempt);
      const retained = new PresentationImages();
      images.current = retained;
      setPresentation({ attempt, photoUri: input.photoUri, source: input.source });
      const photoReady = retained.load(input.photoUri).then((photo) => {
        if (current() && photo && images.current === retained) setPresentation((value) => value && { ...value, photo });
        return photo;
      });
      const context = chosen ?? await resolveContext?.(input);
      if (!current()) return;
      const result = await runCapture({ ...input, ...context }, {
        ...defaultStages,
        onPrepared: async (painting) => {
          const [photo, crop] = await Promise.all([photoReady, retained.load(painting.cropUri)]);
          if (!current() || images.current !== retained) return;
          if (!photo || !crop) { releasePresentation(); completeReveal(attempt); return; }
          setPresentation({ attempt, photoUri: input.photoUri, source: input.source, photo, crop, painting });
          controller.revealing(attempt);
        },
        identify: ({ cropUri: _cropUri, photoUri: _photoUri, visitLocalId: _visitLocalId, owner: _owner, scope, ...payload }) => {
          if (!scope || !owner.isCurrent()) throw new Error('Journal owner changed');
          return identify({ ...payload, scope });
        },
        isOnline: () => online.current !== false,
        resolveVisitId: resolveScanVisit,
      }, captureOptions);
      if (!current()) return;
      setTimings(result.timings);
      if (result.kind === 'retake') {
        releasePresentation();
        if (input.source === 'library') setPresentation({ attempt, photoUri: input.photoUri, source: 'library' });
        controller.fail(attempt, result.message);
      } else {
        pendingResult.current = { attempt, result };
        navigate();
      }
    } catch (error) {
      if (current()) {
        images.current?.release();
        images.current = undefined;
        setPresentation((value) => value?.source === 'library' ? { attempt, photoUri: value.photoUri, source: 'library' } : undefined);
        controller.fail(attempt, error instanceof Error ? error.message : 'Could not capture the painting. Reframe and try again.');
      }
    } finally {
      controller.finish(attempt);
    }
  }

  async function captureFromCamera(attempt: CaptureAttempt | undefined, takePhoto: () => Promise<{ filePath: string }>) {
    if (!attempt) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    return capture(async () => {
      const capturedAt = Date.now();
      const { filePath } = await takePhoto();
      return { photoUri: `file://${filePath}`, quad: attempt.quad, source: 'camera', capturedAt };
    }, attempt, (input) => resolveVenueForScan(input.capturedAt));
  }

  function captureManually(takePhoto: () => Promise<{ filePath: string }>) {
    return captureFromCamera(controller.begin('camera'), takePhoto);
  }

  /** Takes the still for an attempt the controller started from a steady live detection. */
  function captureAutomatically(attempt: CaptureAttempt, takePhoto: () => Promise<{ filePath: string }>) {
    AccessibilityInfo.announceForAccessibility('Artwork captured automatically.');
    return captureFromCamera(attempt, takePhoto);
  }

  function importPhoto() {
    const previous = state.phase === 'retry' && presentation?.source === 'library' ? presentation : undefined;
    const previousMessage = state.message;
    const attempt = controller.begin('library');
    if (!attempt) return;
    let position: { lat: number; lng: number } | undefined;
    return capture(async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Allow photo access in Settings to import a painting.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], exif: true, quality: 1 });
      if (result.canceled || !result.assets[0]) return null;
      const photo = result.assets[0];
      const { capturedAt, lat, lng } = extractCaptureMeta(photo.exif);
      if (lat !== undefined && lng !== undefined) position = { lat, lng };
      return { photoUri: photo.uri, quad: null, source: 'library', capturedAt };
    }, attempt, async () => ({
      venueId: position ? await venueIdAt(position).catch((error: unknown) => {
        console.warn('Could not resolve the venue of the imported photo', error);
        return undefined;
      }) : undefined,
    }), previous ? () => {
      controller.fail(attempt, previousMessage!);
      setPresentation({ attempt, photoUri: previous.photoUri, source: 'library' });
    } : undefined);
  }

  return { controller, state, capture, captureManually, captureAutomatically, importPhoto, presentation, completeReveal, endResultTransition, timings, useCamera: reset };
}
