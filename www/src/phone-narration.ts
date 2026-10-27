import { useEffect, type RefObject } from "react";

import type { PageNarration } from "../server/narration.ts";
import { API } from "./api.ts";
import { followPhone } from "./phone-narration-player.ts";

/** Plays aloud what the phone's audio guide plays, because the cloud iPhone streams no sound. */
export function usePhoneNarration(audio: RefObject<HTMLAudioElement | null>, sessionId: string | undefined) {
  useEffect(() => {
    const element = audio.current;
    if (!element || !sessionId) return;
    const phone = followPhone(element, API);
    const events = new EventSource(`${API}/sessions/${sessionId}/narration`);
    events.onmessage = (event: MessageEvent<string>) => phone.follow(JSON.parse(event.data) as PageNarration);
    return () => {
      events.close();
      phone.stop();
    };
  }, [audio, sessionId]);
}
