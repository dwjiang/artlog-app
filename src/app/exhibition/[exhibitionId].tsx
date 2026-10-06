import { useLocalSearchParams } from "expo-router";

import { ExhibitionScreen } from "@/components/explore/exhibition-screen";

export default function Route() {
  const { exhibitionId } = useLocalSearchParams<{ exhibitionId: string }>();
  return <ExhibitionScreen exhibitionId={exhibitionId} />;
}
