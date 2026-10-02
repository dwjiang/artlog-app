import { setAudioModeAsync } from "expo-audio";

/** Spoken audio plays through the silent switch, keeps going when the phone locks, and pauses other apps' audio. */
export const configureSpokenAudio = () =>
  setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: "doNotMix",
  });
