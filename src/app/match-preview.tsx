import { useLocalSearchParams } from "expo-router";

import { MatchPreviewScreen } from "@/components/scan/result/match-preview-screen";

export default function MatchPreviewRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <MatchPreviewScreen previewId={id} />;
}
