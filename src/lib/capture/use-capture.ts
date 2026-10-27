import { useAction } from "convex/react";
import type { ImageRef } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useNetworkState } from "expo-network";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

import { getVisit } from "@/db/repos/visits";
import { captureOwner, subscribeOwnerChange } from "@/lib/account/owner-store";
import { removeCameraTempFile } from "@/lib/files/camera-temp";
import { shrinkLibraryPhoto } from "@/lib/files/kept-photos";
import { errorMessage, isBackendError } from "@/lib/network-error";
import { isOffline } from "@/lib/network-state";
import { reportError, addBreadcrumb } from "@/lib/observability";
import { failureCopy } from "@/lib/result/failure-copy";
import { toResultViewState } from "@/lib/result/state";
import { playErrorHaptic, playLightHaptic, playSuccessHaptic } from "@/lib/ui/haptics";
import { resolveVenueForScan } from "@/lib/venue/use-venue";
import { venueIdAt } from "@/lib/venue/venue-db";
import { resolveScanVisit } from "@/lib/venue/visit-sync";

import { api } from "../../../convex/_generated/api";
import { CaptureController, type CaptureAttempt } from "./capture-controller";
import { captureOptions, defaultStages } from "./default-stages";
import { extractCaptureMeta } from "./exif";
import { runCapture } from "./pipeline";
import { PresentationImages } from "./presentation-images";
import type { CaptureInput, CaptureResult, CaptureTimings, PreparedPainting } from "./stages";
import type { UprightPhoto } from "./use-upright-photo";

export type CapturePresentation = {
  attempt: CaptureAttempt;
  photoUri: string;
  source: CaptureInput["source"];
  turns?: number;
  photo?: ImageRef;
  painting?: PreparedPainting;
  crop?: ImageRef;
};
type Completed = {
  attempt: CaptureAttempt;
  result: Exclude<CaptureResult, { kind: "retake" }>;
};
type VenueContext = Pick<CaptureInput, "venueId" | "visitId" | "visitLocalId">;
/** A photo chosen for import. The import consumes `uri`; `exif` dates and places the photo when its source keeps it. */
export type PickedPhoto = { uri: string; exif?: ImagePicker.ImagePickerAsset["exif"] };

async function pickFromLibrary(): Promise<PickedPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], exif: true, quality: 1 });
  return result.canceled ? null : (result.assets[0] ?? null);
}

/**
 * `visitLocalId` pins every capture to that visit; `onVisitUnavailable` runs when it no longer exists so the caller can
 * drop it. `view` is the cover-fitted camera preview, which shows only part of each photo.
 */
export function useCapture({
  active = true,
  focused = true,
  visitLocalId,
  view,
  onVisitUnavailable,
}: {
  active?: boolean;
  focused?: boolean;
  visitLocalId?: string;
  view?: CaptureInput["view"];
  onVisitUnavailable?: () => void;
} = {}) {
  const identify = useAction(api.identify.identify);
  const rankCrops = useAction(api.identify.rankCrops);
  const network = useNetworkState();
  const offline = isOffline(network);
  const online = useRef(!offline);
  useEffect(() => {
    online.current = !offline;
  }, [offline]);
  const router = useRouter();
  const navigation = useRef(router);
  useEffect(() => {
    navigation.current = router;
  }, [router]);
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
    if (!mounted.current || !pending || !revealFinished.current || !controller.result(pending.attempt)) {
      return;
    }
    pendingResult.current = undefined;
    // Only a named match confirms; a soft or missing one opens the result without a buzz.
    if (pending.result.kind === "sent" && toResultViewState(pending.result.response).kind === "confident") {
      playSuccessHaptic();
    }
    navigation.current.push({
      pathname: "/result/[scanId]",
      params: {
        scanId: pending.result.kind === "sent" ? pending.result.scanId : `local-${pending.result.localId}`,
        entrance: "capture",
      },
    });
    // Keep the frozen artwork until the native transition takes focus away from Scan.
  }, [controller]);

  const completeReveal = useCallback(
    (attempt: CaptureAttempt) => {
      if (!attempt.valid) return;
      revealFinished.current = true;
      navigate();
    },
    [navigate],
  );

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeOwnerChange(reset);
    return () => {
      mounted.current = false;
      unsubscribe();
      reset();
    };
  }, [reset]);

  useEffect(() => {
    controller.setActive(active && focused);
    if (!focused && controller.getSnapshot().phase !== "result") reset();
    else if (active) navigate();
  }, [active, focused, controller, navigate, reset]);

  const endResultTransition = useCallback(() => {
    if (controller.getSnapshot().phase === "result") reset();
  }, [controller, reset]);

  async function capture(
    getInput: () => Promise<CaptureInput | null>,
    attempt = controller.begin("camera"),
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
    let cameraPhotoUri: string | undefined;
    try {
      // A chosen visit is checked before the photo is taken, so a missing one costs no shutter press.
      let chosen: VenueContext | undefined;
      if (visitLocalId) {
        const visit = await getVisit(visitLocalId, owner.owner);
        if (!current()) return;
        if (!visit) {
          onVisitUnavailable?.();
          throw new Error("This visit is no longer available. Scan again to continue without it.");
        }
        chosen = {
          visitLocalId: visit.localId,
          venueId: visit.venueId,
          visitId: visit.remoteVisitId ?? undefined,
        };
      }
      const input = await getInput();
      if (input?.source === "camera") cameraPhotoUri = input.photoUri;
      if (!current()) return;
      if (!input) {
        (onCancel ?? reset)();
        return;
      }
      addBreadcrumb("capture.started", { source: input.source });
      controller.processing(attempt);
      const retained = new PresentationImages();
      images.current = retained;
      setPresentation({
        attempt,
        photoUri: input.photoUri,
        source: input.source,
        turns: input.turns,
      });
      const photoReady = retained.load(input.photoUri).then((photo) => {
        if (current() && photo && images.current === retained) {
          setPresentation((value) => value && { ...value, photo });
        }
        return photo;
      });
      const context = chosen ?? (await resolveContext?.(input));
      if (!current()) return;
      const result = await runCapture(
        { ...input, ...context },
        {
          ...defaultStages,
          onPrepared: async (painting) => {
            const [photo, crop] = await Promise.all([photoReady, retained.load(painting.cropUri)]);
            if (!current() || images.current !== retained) return;
            if (!photo || !crop) {
              releasePresentation();
              completeReveal(attempt);
              return;
            }
            setPresentation({
              attempt,
              photoUri: input.photoUri,
              source: input.source,
              turns: input.turns,
              photo,
              crop,
              painting,
            });
            controller.revealing(attempt);
          },
          identify: ({
            cropUri: _cropUri,
            photoUri: _photoUri,
            contentBounds: _contentBounds,
            visitLocalId: _visitLocalId,
            owner: _owner,
            scope,
            ...payload
          }) => {
            if (!scope || !owner.isCurrent()) {
              throw new Error("Journal owner changed");
            }
            return identify({ ...payload, scope });
          },
          rankCrops: (vectors, venueId) => rankCrops({ vectors, venueId, modelVersion: captureOptions.modelVersion }),
          isOnline: () => online.current,
          resolveVisitId: resolveScanVisit,
        },
        captureOptions,
      );
      if (!current()) return;
      addBreadcrumb("capture.completed", { outcome: result.kind });
      setTimings(result.timings);
      if (result.kind === "retake") {
        releasePresentation();
        if (input.source === "library") {
          setPresentation({
            attempt,
            photoUri: input.photoUri,
            source: "library",
          });
        }
        playErrorHaptic();
        controller.fail(attempt, result.message);
      } else {
        pendingResult.current = { attempt, result };
        navigate();
      }
    } catch (error) {
      if (current()) {
        reportError(error, "capture.process");
        images.current?.release();
        images.current = undefined;
        setPresentation((value) =>
          value?.source === "library" ? { attempt, photoUri: value.photoUri, source: "library" } : undefined,
        );
        playErrorHaptic();
        controller.fail(
          attempt,
          isBackendError(error)
            ? failureCopy(errorMessage(error))
            : error instanceof Error
              ? error.message
              : "Could not capture the painting. Reframe and try again.",
        );
      }
    } finally {
      // Successful captures move the file into Documents; every other exit leaves it here.
      if (cameraPhotoUri) removeCameraTempFile(cameraPhotoUri);
      controller.finish(attempt);
    }
  }

  async function captureFromCamera(attempt: CaptureAttempt | undefined, takePhoto: () => Promise<UprightPhoto>) {
    if (!attempt) return;
    return capture(
      async () => {
        // Runs after the chosen visit is checked, so a shutter that takes no photo doesn't buzz.
        playLightHaptic();
        const capturedAt = Date.now();
        const { filePath, turns } = await takePhoto();
        return {
          photoUri: `file://${filePath}`,
          quad: attempt.quad,
          source: "camera",
          turns,
          view,
          capturedAt,
        };
      },
      attempt,
      (input) => resolveVenueForScan(input.capturedAt),
    );
  }

  function captureManually(takePhoto: () => Promise<UprightPhoto>) {
    return captureFromCamera(controller.begin("camera"), takePhoto);
  }

  /** Takes the still for an attempt the controller started from a steady live detection. */
  function captureAutomatically(attempt: CaptureAttempt, takePhoto: () => Promise<UprightPhoto>) {
    AccessibilityInfo.announceForAccessibility("Artwork captured automatically.");
    return captureFromCamera(attempt, takePhoto);
  }

  function importPhoto(pick: () => Promise<PickedPhoto | null> = pickFromLibrary) {
    const previous = state.phase === "retry" && presentation?.source === "library" ? presentation : undefined;
    const previousMessage = state.message;
    const attempt = controller.begin("library");
    if (!attempt) return;
    let position: { lat: number; lng: number } | undefined;
    return capture(
      async () => {
        const photo = await pick();
        if (!photo) return null;
        const { capturedAt, lat, lng } = extractCaptureMeta(photo.exif);
        if (lat !== undefined && lng !== undefined) position = { lat, lng };
        return {
          photoUri: await shrinkLibraryPhoto(photo.uri),
          quad: null,
          source: "library",
          capturedAt,
        };
      },
      attempt,
      async () => ({
        venueId: position
          ? await venueIdAt(position).catch((error: unknown) => {
              reportError(error, "capture.resolve_import_venue", {
                level: "warning",
              });
              console.warn("Could not resolve the venue of the imported photo", error);
              return undefined;
            })
          : undefined,
      }),
      previous
        ? () => {
            controller.fail(attempt, previousMessage!);
            setPresentation({
              attempt,
              photoUri: previous.photoUri,
              source: "library",
            });
          }
        : undefined,
    );
  }

  return {
    controller,
    state,
    capture,
    captureManually,
    captureAutomatically,
    importPhoto,
    presentation,
    completeReveal,
    endResultTransition,
    timings,
    useCamera: reset,
  };
}
