import { useLocalSearchParams } from "expo-router";

import { GalleryBackToolbar } from "@/components/gallery-back-toolbar";
import { ResultScreen } from "@/components/scan/result-screen";

export default function ResultRoute() {
  const { scanId, edit } = useLocalSearchParams<{
    scanId: string;
    edit?: string;
  }>();
  return (
    <>
      <GalleryBackToolbar />
      <ResultScreen scanId={scanId} manual={edit === "1"} />
    </>
  );
}
