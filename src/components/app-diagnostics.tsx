import * as Sentry from "@sentry/react-native";
import { useNavigationContainerRef, useSegments } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";

import { addBreadcrumb } from "@/lib/observability";
import { navigationIntegration } from "@/lib/sentry";

export function AppDiagnostics() {
  const navigationRef = useNavigationContainerRef();
  useEffect(() => {
    navigationIntegration.registerNavigationContainer(navigationRef);
  }, [navigationRef]);
  // File segments retain [scanId] rather than the actual ID or search parameters.
  const route = useSegments().join("/") || "index";
  useEffect(() => {
    Sentry.setTag("route", route);
    addBreadcrumb("navigation.changed", { route });
  }, [route]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => addBreadcrumb("app.state", { state }));
    return () => subscription.remove();
  }, []);
  return null;
}
