import { router, usePreventRemove } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

/** Asks before throwing edits away; `discard` runs only if the person chooses to discard them. */
export function confirmDiscardEdits(discard: () => void) {
  Alert.alert("Discard your edits?", undefined, [
    { text: "Keep Editing", style: "cancel" },
    { text: "Discard Edits", style: "destructive", onPress: discard },
  ]);
}

/**
 * While `edited`, closing the screen by swipe, back button or a `router.back()` Cancel asks before discarding the
 * edits. While `busy`, the screen stays open without asking, so a save in flight finishes first. Returns `leave`, which
 * closes the screen without asking, by going back or by `navigate`, for a save that kept the edits.
 */
export function useDiscardEditsGuard({ edited, busy = false }: { edited: boolean; busy?: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const allowRemoval = usePreventRemove((edited || busy) && !leaving, ({ repeat }) => {
    if (busy) return;
    confirmDiscardEdits(() => {
      setLeaving(true);
      repeat();
    });
  });
  return (navigate: () => void = () => router.back()) => {
    setLeaving(true);
    allowRemoval();
    navigate();
  };
}
