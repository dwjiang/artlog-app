import { AppState } from "react-native";
import { getAllCameraDevices, VisionCamera, type CameraViewProps } from "react-native-vision-camera";

import { addBreadcrumb } from "@/lib/observability";

export function recordCameraFailure(props: Pick<CameraViewProps, "device" | "isActive">): void {
  try {
    const devices = getAllCameraDevices();
    const position = typeof props.device === "string" ? props.device : "explicit";
    const permission = VisionCamera.cameraPermissionStatus;
    // This cache may still be loading; an empty snapshot is not proof of absent hardware.
    addBreadcrumb("camera.failure_snapshot", {
      requested_position: ["front", "back", "external", "explicit"].includes(position) ? position : "other",
      requested_active: props.isActive === true,
      app_state: ["active", "inactive", "background"].includes(AppState.currentState ?? "unknown")
        ? AppState.currentState
        : "unknown",
      permission: ["authorized", "denied", "not-determined", "restricted"].includes(permission)
        ? permission
        : "unknown",
      discovery_source: "cached_non_atomic",
      cached_device_count: Math.min(devices.length, 32),
      cached_back_count: Math.min(devices.filter((device) => device.position === "back").length, 32),
      cached_front_count: Math.min(devices.filter((device) => device.position === "front").length, 32),
    });
  } catch {
    // Diagnostics must never prevent the caller from handling the original camera error.
  }
}
