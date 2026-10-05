import { useLocalSearchParams } from "expo-router";

import { TagScreen } from "@/components/social/tag-screen";

export default function TagRoute() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  return <TagScreen tag={tag} />;
}
