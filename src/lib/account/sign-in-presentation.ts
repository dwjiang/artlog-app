import { AppState } from "react-native";

// Long enough to come back from another app, short enough that Apple's 5-minute challenge survives a retry.
const ACTIVE_WAIT_LIMIT_MS = 60_000;

function waitUntilActive(): Promise<"none" | "returned" | "timed_out"> {
  if (AppState.currentState === "active") return Promise.resolve("none");
  return new Promise((resolve) => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      clearTimeout(timer);
      subscription.remove();
      resolve("returned");
    });
    const timer = setTimeout(() => {
      subscription.remove();
      resolve("timed_out");
    }, ACTIVE_WAIT_LIMIT_MS);
  });
}

// iOS can only attach a provider's sign-in sheet to a window of the foreground app. Leaving the app
// between the tap and the native call fails without a window, so present once active and retry once.
export async function presentWhenActive<T>(
  present: () => Promise<T>,
  missingWindow: (cause: unknown) => boolean,
  data: Record<string, unknown>,
): Promise<T> {
  data.active_wait = await waitUntilActive();
  try {
    return await present();
  } catch (cause) {
    if (!missingWindow(cause)) throw cause;
    data.presentation_retried = true;
    data.retry_active_wait = await waitUntilActive();
    return present();
  }
}
