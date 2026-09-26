import Constants from "expo-constants";
import { Image } from "expo-image";
import * as Location from "expo-location";
import * as MediaLibrary from "expo-media-library";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useCameraPermission } from "react-native-vision-camera";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { reportError } from "@/lib/observability";

export type AccessKey = "camera" | "photos" | "location";
type Answer = "granted" | "declined" | "unanswered";
type Permission = { granted: boolean; canAskAgain: boolean } | null;
type Prompt = { title: (app: string) => string; message: string; options: readonly string[]; allowed: string };
type Line = { text: string; boundary?: boolean };
export type AccessStep = {
  key: AccessKey;
  name: string;
  headline: string;
  wall: string;
  prompt: Prompt;
  lines: readonly Line[];
  answer: Answer;
  request: () => Promise<unknown>;
};

/** The iPhone prompts as iOS 26 words them. Messages must match the usage strings in app.json. */
export const accessPrompts: Record<AccessKey, Prompt> = {
  camera: {
    title: (app) => `“${app}” would like to access the Camera.`,
    message: "Artlog uses the camera to identify paintings and read wall labels.",
    options: ["Don’t Allow", "Allow"],
    allowed: "Allow",
  },
  photos: {
    title: (app) => `“${app}” would like to add to your Photos.`,
    message: "Artlog adds the full-size photos of artworks you save to your photo library.",
    options: ["Don’t Allow", "Allow"],
    allowed: "Allow",
  },
  location: {
    title: (app) => `Allow “${app}” to use your location?`,
    message: "Artlog uses your location to find nearby museums.",
    options: ["Allow Once", "Allow While Using App", "Don’t Allow"],
    allowed: "Allow While Using App",
  },
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
      wall: "#4C5B6B",
      prompt: accessPrompts.camera,
      lines: [
        { text: "Identifies the painting in front of you" },
        { text: "Reads the wall label" },
        { text: "Artwork photos stay on your phone", boundary: true },
      ],
      answer: answerOf({ granted: camera.hasPermission, canAskAgain: camera.canRequestPermission }),
      request: camera.requestPermission,
    },
    {
      key: "photos",
      name: "photos",
      headline: "Keep the photo.",
      wall: "#CDD0CA",
      prompt: accessPrompts.photos,
      lines: [
        { text: "Adds each artwork you save to Photos" },
        { text: "Keeps the full-size original" },
        { text: "Can't see your existing photos", boundary: true },
      ],
      answer: answerOf(photos),
      request: requestPhotos,
    },
    {
      key: "location",
      name: "location",
      headline: "Find the museum.",
      wall: "#45524B",
      prompt: accessPrompts.location,
      lines: [
        { text: "Names the museum you're in" },
        { text: "Groups the visit's artworks" },
        { text: "Never used in the background", boundary: true },
      ],
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

/** A rehearsal of the iPhone prompt, drawn like the iOS 26 sheet, with the answer Artlog needs marked. */
export function PromptPreview({ prompt, stacked }: { prompt: Prompt; stacked: boolean }) {
  const app = Constants.expoConfig?.name ?? "Artlog";
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dialog}>
      <Text maxFontSizeMultiplier={1.4} style={styles.dialogTitle}>
        {prompt.title(app)}
      </Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.dialogMessage}>
        {prompt.message}
      </Text>
      <View style={stacked ? styles.optionStack : styles.optionRow}>
        {prompt.options.map((option) => {
          const allowed = option === prompt.allowed;
          return (
            <View key={option} style={[styles.option, allowed && styles.optionAllowed]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.optionText, allowed && styles.optionAllowedText]}>
                {option}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function AccessLines({ lines }: { lines: readonly Line[] }) {
  return (
    <View style={styles.lines}>
      {lines.map((line) => (
        <View key={line.text} style={styles.line}>
          <Image
            source={line.boundary ? "sf:lock" : "sf:checkmark"}
            tintColor={line.boundary ? Gallery.muted : Gallery.ink}
            accessible={false}
            style={styles.lineIcon}
          />
          <Text themeColor={line.boundary ? "textSecondary" : undefined} style={styles.lineText}>
            {line.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dialog: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 30,
    padding: Spacing.content,
    gap: Spacing.two,
    backgroundColor: Gallery.surface,
    boxShadow: "0 16px 34px -14px rgba(0,0,0,0.45)",
  },
  dialogTitle: { fontSize: 20, lineHeight: 25, fontWeight: "600", color: Gallery.ink },
  dialogMessage: { fontSize: 15, lineHeight: 20, color: Gallery.muted, marginBottom: Spacing.compact },
  optionRow: { flexDirection: "row", gap: Spacing.compact },
  optionStack: { gap: Spacing.two },
  option: {
    flex: 1,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.full,
    backgroundColor: Gallery.fill,
  },
  optionAllowed: { backgroundColor: Gallery.highlight },
  optionText: { fontSize: 16, lineHeight: 21, fontWeight: "500", color: Gallery.ink },
  optionAllowedText: { fontWeight: "600" },
  lines: { gap: Spacing.two },
  line: { flexDirection: "row", alignItems: "center", gap: Spacing.compact },
  lineIcon: { width: 20, height: 20 },
  lineText: { ...Typography.body, flex: 1 },
});
