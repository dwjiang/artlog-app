import { useAction } from 'convex/react';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useNetworkState } from 'expo-network';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { api } from '../../../convex/_generated/api';
import { captureOptions, defaultStages } from './default-stages';
import { extractCaptureMeta } from './exif';
import { runCapture } from './pipeline';
import type { CaptureInput, CaptureTimings } from './stages';

export function useCapture() {
  const identify = useAction(api.identify.identify);
  const network = useNetworkState();
  const online = useRef(network.isInternetReachable);
  useEffect(() => { online.current = network.isInternetReachable; }, [network.isInternetReachable]);
  const router = useRouter();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [timings, setTimings] = useState<CaptureTimings>();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function capture(getInput: () => Promise<CaptureInput | null>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(undefined);
    setTimings(undefined);
    try {
      const input = await getInput();
      if (!input) return;
      const result = await runCapture(input, {
        ...defaultStages,
        identify: ({ cropUri: _cropUri, photoUri: _photoUri, ...payload }) => identify(payload),
        isOnline: () => online.current !== false,
      }, captureOptions);
      if (!mounted.current) return;
      setTimings(result.timings);
      if (result.kind === 'retake') {
        setMessage(result.message);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      } else {
        router.push({
          pathname: '/result/[scanId]',
          params: { scanId: result.kind === 'sent' ? result.scanId : `local-${result.localId}` },
        });
      }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : 'Could not capture the painting. Try again.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function importPhoto() {
    return capture(async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Allow photo access in Settings to import a painting.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], exif: true, quality: 1 });
      if (result.canceled || !result.assets[0]) return null;
      const photo = result.assets[0];
      const { capturedAt } = extractCaptureMeta(photo.exif);
      // Imported photos get their own venue/visit context in plan 03.05.
      return { photoUri: photo.uri, quad: null, source: 'library', capturedAt };
    });
  }

  return { capture, importPhoto, busy, message, timings, clearMessage: () => setMessage(undefined) };
}
