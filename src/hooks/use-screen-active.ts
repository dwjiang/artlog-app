import { useIsFocused } from "expo-router/react-navigation";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

function subscribe(listener: () => void) {
  const subscription = AppState.addEventListener("change", listener);
  return () => subscription.remove();
}

const isAppActive = () => AppState.currentState === "active";

export function useScreenActive(): boolean {
  const isFocused = useIsFocused();
  const isActive = useSyncExternalStore(subscribe, isAppActive);
  return isFocused && isActive;
}
