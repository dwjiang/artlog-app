import * as Haptics from "expo-haptics";

// Each haptic pairs with a visible change in the same frame, once per user action. It is rejected while the Taptic
// Engine is off (Low Power Mode, settings), and the visible change still carries the feedback.
function play(feedback: Promise<void>) {
  void feedback.catch(() => {});
}

/** A choice moved to another value: a segment, an option, a scrub into the next section. */
export function playSelectionHaptic() {
  play(Haptics.selectionAsync());
}

/** A light commit: a shutter, a toggle turning on, a piece picked up or dropped. */
export function playLightHaptic() {
  play(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A heavier moment: a long-press menu opening or a destructive action. */
export function playMediumHaptic() {
  play(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** A toggle the user flipped, such as a like or a bookmark: a light commit turning on, a softer tick turning off. */
export function playToggleHaptic(on: boolean) {
  if (on) playLightHaptic();
  else playSelectionHaptic();
}

/** An operation the user started has finished. */
export function playSuccessHaptic() {
  play(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** An operation the user started has failed. */
export function playErrorHaptic() {
  play(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
