import { createAudioPlayer } from "expo-audio";

import { seekableDuration } from "../../../modules/audio-seeking/src";
import type { AudioHandle } from "./listening-controller";

export function createNarrationPlayer(uri: string): AudioHandle {
  const player = createAudioPlayer(uri, { updateInterval: 250 });
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
    remove: () => player.remove(),
    setPlaybackRate: (rate) => player.setPlaybackRate(rate),
    setActiveForLockScreen: (...args) => player.setActiveForLockScreen(...args),
    addListener: (...args) => player.addListener(...args),
  };
}
