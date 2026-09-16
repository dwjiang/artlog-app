import { resolveCaptureVisit } from './visit-context';
import { useAction } from 'convex/react';
import * as Haptics from 'expo-haptics';
import type { ImageRef } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useNetworkState } from 'expo-network';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { captureOwner, subscribeOwnerChange } from '@/lib/account/owner-store';
import { api } from '../../../convex/_generated/api';
import { venueIdAt } from '@/lib/venue/venue-db';
import { resolveVenueForScan } from '@/lib/venue/use-venue';
import { CaptureController, type CaptureAttempt } from './capture-controller';
import { captureOptions, defaultStages, labelWarper } from './default-stages';
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
type Completed = { subject?: 'label'; attempt: CaptureAttempt; result: Exclude<CaptureResult, { kind: 'retake' }> };
type VenueContext = Pick<CaptureInput, 'venueId' | 'visitId' | 'visitLocalId'>;

export function useCapture({ active = true, focused = true } = {}) {
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
      pathname: pending.subject === 'label' ? '/label/[scanId]' : '/result/[scanId]',
      params: { scanId: pending.result.kind === 'sent' ? pending.result.scanId : `local-${pending.result.localId}`, entrance: 'capture', ...(pending.subject === 'label' ? { intent: 'review' } : {}) },
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
      const context = await resolveContext?.(input);
      if (!current()) return;
      const result = await runCapture({ ...input, ...context }, {
        ...defaultStages,
        ...(input.subject === 'label' ? { warper: labelWarper } : {}),
        onPrepared: async (painting) => {
          if (input.subject === 'label') { releasePresentation(); completeReveal(attempt); return; }
          const [photo, crop] = await Promise.all([photoReady, retained.load(painting.cropUri)]);
          if (!current() || images.current !== retained) return;
          if (!photo || !crop) { releasePresentation(); completeReveal(attempt); return; }
          setPresentation({ attempt, photoUri: input.photoUri, source: input.source, photo, crop, painting });
          controller.revealing(attempt);
        },
        identify: ({ subject: _subject, cropUri: _cropUri, photoUri: _photoUri, visitLocalId: _visitLocalId, owner: _owner, scope, ...payload }) => {
          if (!scope || !owner.isCurrent()) throw new Error('Journal owner changed');
          return identify({ ...payload, scope });
        },
        isOnline: () => online.current !== false,
      }, captureOptions);
      if (!current()) return;
      setTimings(result.timings);
      if (result.kind === 'retake') {
        releasePresentation();
        if (input.source === 'library') setPresentation({ attempt, photoUri: input.photoUri, source: 'library' });
        controller.fail(attempt, result.message);
      } else {
        pendingResult.current = { attempt, result, subject: input.subject };
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

  function captureManually(takePhoto: () => Promise<{ filePath: string }>, subject?: 'label') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    return capture(async () => {
      const capturedAt = Date.now();
      const { filePath } = await takePhoto();
      return { photoUri: `file://${filePath}`, quad: null, source: 'camera', capturedAt, ...(subject ? { subject } : {}) };
    }, undefined, (input) => resolveCaptureVisit(() => resolveVenueForScan(input.capturedAt)));
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
    }, attempt, async () => resolveCaptureVisit(async () => ({
      venueId: position ? await venueIdAt(position).catch((error: unknown) => {
        console.warn('Could not resolve the venue of the imported photo', error);
        return undefined;
      }) : undefined,
    })), previous ? () => {
      controller.fail(attempt, previousMessage!);
      setPresentation({ attempt, photoUri: previous.photoUri, source: 'library' });
    } : undefined);
  }

  return { controller, state, capture, captureManually, importPhoto, presentation, completeReveal, endResultTransition, timings, useCamera: reset };
}
