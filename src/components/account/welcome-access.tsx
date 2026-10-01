import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import { useState } from "react";
import { useCameraPermission } from "react-native-vision-camera";

import { reportError } from "@/lib/observability";

export type AccessKey = "camera" | "photos" | "location";
type Answer = "granted" | "declined" | "unanswered";
type Permission = { granted: boolean; canAskAgain: boolean } | null;
export type AccessStep = {
  key: AccessKey;
  name: string;
  headline: string;
  caption: string;
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
      name: "camera",
      headline: "Scan artworks.",
      // No on-device promise: saved photos can reach the Wall, shared visits, and account backups.
      caption: "Identifies paintings and reads their wall labels.",
      answer: answerOf({ granted: camera.hasPermission, canAskAgain: camera.canRequestPermission }),
      request: camera.requestPermission,
    },
    {
      key: "photos",
      name: "photos",
      headline: "Keep the photo.",
      caption: "Adds the full-size original of each artwork you save. Artlog can’t see your other photos.",
      answer: answerOf(photos),
      request: requestPhotos,
    },
    {
      key: "location",
      name: "location",
      headline: "Find the museum.",
      caption: "Names the museum you’re in and groups each visit. Only used while Artlog is open.",
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
