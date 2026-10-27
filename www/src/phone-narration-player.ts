import HlsPlayer from "hls.js";

import type { PageNarration } from "../server/narration.ts";

// Between the phone's reports the page seeks back to its position only past this drift, so buffering hiccups don't
// cause audible skips; a new report, such as a play, pause or seek, lines it up closer.
const DRIFT_SECONDS = 1;
const REPORT_DRIFT_SECONDS = 0.2;
const CHECK_MS = 2000;

export function followPhone(audio: HTMLAudioElement, apiRoot: string) {
  let target: PageNarration = null;
  let receivedAt = 0;
  let src: string | undefined;
  let hls: HlsPlayer | undefined;
  let objectUrl: string | undefined;
  let pending: AbortController | undefined;

  const sync = (drift: number) => {
    if (!target) return;
    if (target.src !== src) {
      void load(target).catch(() => undefined);
      return;
    }
    if (audio.readyState < audio.HAVE_METADATA) return;
    const elapsed = target.playing ? ((performance.now() - receivedAt) / 1000) * target.rate : 0;
    audio.playbackRate = target.rate;
    if (Math.abs(audio.currentTime - (target.position + elapsed)) > drift) {
      audio.currentTime = target.position + elapsed;
    }
    if (target.playing && audio.paused) void audio.play().catch(() => undefined);
    if (!target.playing && !audio.paused) audio.pause();
  };

  const unload = () => {
    pending?.abort();
    pending = undefined;
    hls?.destroy();
    hls = undefined;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
    audio.removeAttribute("src");
    audio.load();
  };

  const load = async ({ src: next, live, position }: NonNullable<PageNarration>) => {
    unload();
    src = next;
    const url = `${apiRoot}/${next}`;
    // oxlint-disable-next-line import/no-named-as-default-member -- hls.js types declare only the default export.
    if (live && HlsPlayer.isSupported()) {
      hls = new HlsPlayer({ startPosition: position });
      hls.loadSource(url);
      hls.attachMedia(audio);
    } else if (live) {
      audio.src = url;
    } else {
      // A whole file can seek anywhere; this origin serves it without byte ranges.
      const request = new AbortController();
      pending = request;
      const blob = await fetch(url, { signal: request.signal })
        .then((response) => (response.ok ? response.blob() : undefined))
        .catch(() => undefined);
      if (request.signal.aborted) return;
      pending = undefined;
      if (!blob) {
        // A later report or sync tick retries without needing the phone to select a different narration.
        src = undefined;
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      audio.src = objectUrl;
    }
  };

  const onLoaded = () => sync(REPORT_DRIFT_SECONDS);
  audio.addEventListener("loadedmetadata", onLoaded);
  const timer = setInterval(() => sync(DRIFT_SECONDS), CHECK_MS);
  return {
    follow(next: PageNarration) {
      target = next;
      receivedAt = performance.now();
      if (!next) {
        src = undefined;
        unload();
      }
      sync(REPORT_DRIFT_SECONDS);
    },
    stop() {
      clearInterval(timer);
      audio.removeEventListener("loadedmetadata", onLoaded);
      src = undefined;
      unload();
    },
  };
}
