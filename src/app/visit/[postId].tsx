import { useLocalSearchParams } from "expo-router";

import { VisitScreen } from "@/components/social/visit-screen";

export default function VisitRoute() {
  const { postId, comments } = useLocalSearchParams<{ postId: string; comments?: string }>();
  return <VisitScreen postId={postId} openComments={comments === "1"} />;
}
