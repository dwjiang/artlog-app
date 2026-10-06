import { useLocalSearchParams } from "expo-router";

import { MuseumScreen } from "@/components/explore/museum-screen";

export default function Route() {
  const { museumId } = useLocalSearchParams<{ museumId: string }>();
  return <MuseumScreen museumId={museumId} />;
}
