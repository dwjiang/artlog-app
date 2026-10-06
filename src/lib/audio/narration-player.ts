import { createAudioPlayer } from "expo-audio";

import { seekableDuration } from "../../../modules/audio-seeking/src";
import type { AudioHandle } from "./listening-controller";
import { PLAYBACK_UPDATE_MS } from "./narration";

export function createNarrationPlayer(uri: string): AudioHandle {
  const player = createAudioPlayer(uri, { updateInterval: PLAYBACK_UPDATE_MS });
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
