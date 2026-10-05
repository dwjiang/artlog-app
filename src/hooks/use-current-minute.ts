import { useEffect, useState } from "react";
import { AppState } from "react-native";

const MINUTE = 60_000;
const currentMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE;

export function useCurrentMinute() {
  const [minute, setMinute] = useState(currentMinute);
  useEffect(() => {
    const update = () => setMinute(currentMinute());
    const timer = setInterval(update, MINUTE);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") update();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  return minute;
}
