import { useLocalSearchParams } from "expo-router";

import { LabelCaptureScreen } from "@/components/scan/label-capture-screen";

export default function LabelCaptureRoute() {
  const { scanId, intent } = useLocalSearchParams<{
    scanId: string;
    intent?: string;
  }>();
  return (
    <LabelCaptureScreen
      scanId={scanId}
      intent={intent === "capture" ? "capture" : "review"}
    />
  );
}
