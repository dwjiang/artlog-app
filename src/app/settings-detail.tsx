import { useLocalSearchParams } from "expo-router";
import { SettingsDetailScreen } from "@/components/settings/settings-detail-screen";

export default function SettingsDetailRoute() {
  const { section } = useLocalSearchParams<{ section: string }>();
  return <SettingsDetailScreen section={section} />;
}
