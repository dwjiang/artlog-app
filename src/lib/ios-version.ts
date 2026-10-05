import { Platform } from "react-native";

export function isIOS26OrLater() {
  return Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26;
}
