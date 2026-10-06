import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import { useState } from "react";
import { useCameraPermission } from "react-native-vision-camera";

import type { PermissionKind } from "@/components/permissions/permission-ask";
import { reportError } from "@/lib/observability";

export type AccessKey = Exclude<PermissionKind, "notifications">;
type Answer = "granted" | "declined" | "unanswered";
type Permission = { granted: boolean; canAskAgain: boolean } | null;
export type AccessStep = {
  key: AccessKey;
  answer: Answer;
  request: () => Promise<unknown>;
};

function answerOf(permission: Permission): Answer {
  if (permission?.granted) return "granted";
  return permission?.canAskAgain === false ? "declined" : "unanswered";
}

/** The welcome's optional permissions, one page each; `answer` resolves once the iPhone prompt is dismissed. */
export function useWelcomeAccess() {
  const camera = useCameraPermission();
  // Write-only: Artlog adds the originals of saved artworks and never reads the library.
  const [photos, requestPhotos] = MediaLibrary.usePermissions({ writeOnly: true });
  const [location, requestLocation] = Location.useForegroundPermissions();
  const [asking, setAsking] = useState<AccessKey>();
  const steps: AccessStep[] = [
    {
      key: "camera",
      answer: answerOf({ granted: camera.hasPermission, canAskAgain: camera.canRequestPermission }),
      request: camera.requestPermission,
    },
    {
      key: "photos",
      answer: answerOf(photos),
      request: requestPhotos,
    },
    {
      key: "location",
      answer: answerOf(location),
      request: requestLocation,
    },
  ];

  // iOS asks only once; an answered permission is left as it is and changes in Settings.
  const answer = async (step: AccessStep) => {
    if (asking || step.answer !== "unanswered") return;
    setAsking(step.key);
    try {
      await step.request();
    } catch (cause: unknown) {
      reportError(cause, "account.welcome.permission", { data: { permission: step.key } });
    } finally {
      setAsking(undefined);
    }
  };

  return { steps, asking, answer };
}
