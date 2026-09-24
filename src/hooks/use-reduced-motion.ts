import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let current = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      changed = true;
      setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (current && !changed) setReduced(value);
      })
      .catch(() => {});
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
