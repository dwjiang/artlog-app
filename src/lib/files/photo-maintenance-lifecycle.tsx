import { useEffect } from "react";
import { AppState } from "react-native";
import { maintainStoredPhotos } from "./photo-maintenance";

export function PhotoMaintenance() {
  useEffect(() => {
    const run = () => {
      void maintainStoredPhotos();
    };
    run();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => subscription.remove();
  }, []);
  return null;
}
