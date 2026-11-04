import { useEffect } from "react";

import { addBreadcrumb } from "@/lib/observability";

// A native teardown crash can bypass onError. Record requested lifecycle separately from native callbacks.
export function useCameraLifecycle(isActive: boolean): void {
  useEffect(() => {
    addBreadcrumb("camera.mounted");
    return () => addBreadcrumb("camera.unmounted");
  }, []);
  useEffect(() => {
    addBreadcrumb("camera.active_requested", { requested_active: isActive });
  }, [isActive]);
}
