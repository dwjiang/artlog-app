import { requireNativeModule } from "expo";
import type { AudioPlayer } from "expo-audio";

type AudioSeeking = { seekableDuration(player: AudioPlayer): number };
let native: AudioSeeking | undefined;

export function seekableDuration(player: AudioPlayer) {
  native ??= requireNativeModule<AudioSeeking>("AudioSeeking");
  return native.seekableDuration(player);
}
