import { createAudioPlayer } from "expo-audio";

import { isJudgesDemo } from "@/lib/judges-demo";

import { seekableDuration } from "../../../modules/audio-seeking/src";
import { mirrorToDemoPage } from "./demo-narration";
import type { AudioHandle } from "./listening-controller";
import { PLAYBACK_UPDATE_MS } from "./narration";

export function createNarrationPlayer(uri: string): AudioHandle {
  const player = createAudioPlayer(uri, { updateInterval: PLAYBACK_UPDATE_MS });
  const stopMirror = isJudgesDemo() ? mirrorToDemoPage(uri, player) : undefined;
  return {
    get currentStatus() {
      return player.currentStatus;
    },
    get seekableDuration() {
      return seekableDuration(player);
    },
    play: () => player.play(),
    pause: () => player.pause(),
    seekTo: (...args) => player.seekTo(...args),
    remove: () => {
      stopMirror?.();
      player.remove();
    },
    setPlaybackRate: (rate) => player.setPlaybackRate(rate),
    setActiveForLockScreen: (...args) => player.setActiveForLockScreen(...args),
    addListener: (...args) => player.addListener(...args),
  };
}
