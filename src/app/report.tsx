import { useLocalSearchParams } from "expo-router";

import { ReportScreen } from "@/components/social/report-screen";

export default function ReportRoute() {
  const { kind, id, renderId } = useLocalSearchParams<{ kind: string; id: string; renderId?: string }>();
  return <ReportScreen kind={kind} id={id} renderId={renderId} />;
}
