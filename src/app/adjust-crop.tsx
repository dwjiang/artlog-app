import { useLocalSearchParams } from "expo-router";
import { AdjustCropScreen } from "@/components/collection/adjust-crop-screen";

export default function AdjustCropRoute() {
  const { savedId, photoId } = useLocalSearchParams<{ savedId: string; photoId?: string }>();
  return <AdjustCropScreen savedId={savedId} photoId={photoId} />;
}
