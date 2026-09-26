import type { PropsWithChildren } from "react";
import { View } from "react-native";

import { AppUpdateScreen } from "@/components/app-update-screen";
import { LoadingRing } from "@/components/loading-ring";
import { Gallery } from "@/constants/theme";
import { useAppCompatibility } from "@/lib/use-app-compatibility";

export function AppUpdateGate({ children }: PropsWithChildren) {
  const { loading, updateRequired } = useAppCompatibility();
  if (updateRequired) return <AppUpdateScreen />;
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Gallery.paper }}>
        <LoadingRing accessibilityLabel="Opening Artlog" color={Gallery.accent} />
      </View>
    );
  }
  return children;
}
