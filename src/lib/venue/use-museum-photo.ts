import { useMutation, useQueries, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";

import { isNetworkError } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { useDeviceReady } from "@/lib/use-device-ready";

import { api } from "../../../convex/_generated/api";
import { useVenue } from "./use-venue";

type MuseumPhotoResult = FunctionReturnType<typeof api.museumPhotos.forVenue>;
export type MuseumPhoto = NonNullable<MuseumPhotoResult["photo"]>;

/** "Jane Doe · CC BY-SA 4.0": the credit the photo's licence asks for, empty when it asks for none. */
export const photoCredit = (photo: MuseumPhoto) => [photo.author, photo.license].filter(Boolean).join(" · ");

/**
 * The museum's Commons photo. The first person to see a museum asks the backend to look its photo up. `settled` is
 * false only while the backend's first answer loads; an unfinished lookup or a failed read settles without a photo.
 */
export function useMuseumPhoto(venueId: string | undefined): { photo?: MuseumPhoto; settled: boolean } {
  const deviceReady = useDeviceReady();
  const queries = useMemo(
    (): RequestForQueries =>
      deviceReady && venueId ? { photo: { query: api.museumPhotos.forVenue, args: { venueId } } } : {},
    [deviceReady, venueId],
  );
  const { photo: result }: { photo?: MuseumPhotoResult | Error } = useQueries(queries);
  const loaded = result instanceof Error ? undefined : result;
  const request = useMutation(api.museumPhotos.request);
  const unchecked = !!loaded && !loaded.checked;
  useEffect(() => {
    if (result instanceof Error) reportError(result, "venue.photo.load");
  }, [result]);
  useEffect(() => {
    if (!unchecked || !venueId) return;
    const requestPhoto = () => {
      void request({ venueId }).catch((cause) => {
        if (!isNetworkError(cause)) reportError(cause, "venue.photo.request");
      });
    };
    requestPhoto();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") requestPhoto();
    });
    return () => subscription.remove();
  }, [unchecked, venueId, request]);
  return { photo: loaded?.photo ?? undefined, settled: !queries.photo || result !== undefined };
}

/**
 * The Commons photo of the open visit's museum, or of the museum the phone is at before a visit starts. Undefined
 * while loading, offline or when there is none.
 */
export function useCurrentMuseumPhoto(): MuseumPhoto | undefined {
  const { visit, ready } = useVenue();
  return useMuseumPhoto(visit?.venueId ?? (ready?.kind === "here" ? ready.venue.venueId : undefined)).photo;
}
