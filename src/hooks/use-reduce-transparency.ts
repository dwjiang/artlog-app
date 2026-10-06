import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Whether Reduce Transparency is on, following changes while mounted. */
export function useReduceTransparency(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    let active = true;
    let receivedChange = false;
    void (async () => {
      const enabled = await AccessibilityInfo.isReduceTransparencyEnabled();
      if (active && !receivedChange) setReduceTransparency(enabled);
    })();
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", (enabled) => {
      receivedChange = true;
      setReduceTransparency(enabled);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduceTransparency;
}
