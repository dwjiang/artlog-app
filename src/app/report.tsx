import { useLocalSearchParams } from "expo-router";

import { ReportScreen } from "@/components/social/report-screen";

export default function ReportRoute() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  return <ReportScreen kind={kind} id={id} />;
}
