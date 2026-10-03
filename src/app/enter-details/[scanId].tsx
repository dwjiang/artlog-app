import { useLocalSearchParams } from "expo-router";

import { EnterDetailsScreen } from "@/components/scan/enter-details-screen";

import type { Id } from "../../../convex/_generated/dataModel";

export default function EnterDetailsRoute() {
  const { scanId } = useLocalSearchParams<{ scanId: Id<"scans"> }>();
  return <EnterDetailsScreen scanId={scanId} />;
}
