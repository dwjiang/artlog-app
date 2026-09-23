import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useEffect, useState } from "react";
import { cachedNarrationUri } from "./narration-renderer";

export function useCachedNarrationDuration(renderId: string | undefined) {
  const [cached, setCached] = useState<{ renderId: string; uri: string }>();
  useEffect(() => {
    if (!renderId) return;
    let cancelled = false;
    void cachedNarrationUri(renderId)
      .then((uri) => {
        if (!cancelled && uri) setCached({ renderId, uri });
      })
      .catch(() => {
        /* Cache lookup is optional; leave the duration unknown. */
      });
    return () => {
      cancelled = true;
    };
  }, [renderId]);
  const uri = cached?.renderId === renderId ? cached?.uri : undefined;
  // Loading a local file reads its duration without starting playback or fetching audio.
  const player = useAudioPlayer(uri ?? null);
  const status = useAudioPlayerStatus(player);
  return uri &&
    status.id === player.id &&
    status.isLoaded &&
    Number.isFinite(status.duration) &&
    status.duration > 0
    ? status.duration
    : undefined;
}
