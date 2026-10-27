import { Directory, File, Paths } from "expo-file-system";

import { JUDGES_DEMO_FILES, JUDGES_DEMO_FOLDER, type DemoNarration } from "@/shared/capture/judges-demo";

import type { AudioHandle, Playback } from "./listening-controller";

// The demo page seeks to the reported position past this drift; a smaller one would report every buffering hiccup.
const DRIFT_SECONDS = 1;

/** The report `status` calls for, or undefined while the last report still predicts it. */
export function nextReport(
  last: DemoNarration | undefined,
  source: string,
  status: Playback,
  now: number,
): DemoNarration | undefined {
  // AVPlayer reports a rate of 0 while paused.
  const rate = status.playbackRate !== undefined && status.playbackRate > 0 ? status.playbackRate : (last?.rate ?? 1);
  const next = { source, playing: status.playing, position: status.currentTime, rate, at: now };
  if (!last || last.source !== source || last.playing !== next.playing || last.rate !== rate) return next;
  const predicted = last.position + (last.playing ? ((now - last.at) / 1000) * last.rate : 0);
  return Math.abs(next.position - predicted) > DRIFT_SECONDS ? next : undefined;
}

/** A cached narration's path inside the app's data container, which the demo host reads it from. */
export function demoSource(uri: string, documentUri = Paths.document.uri): string {
  if (!uri.startsWith("file:")) return uri;
  const container = documentUri.replace(/Documents\/?$/, "");
  return decodeURI(uri.startsWith(container) ? uri.slice(container.length) : uri);
}

function write(report: DemoNarration) {
  try {
    new File(new Directory(Paths.document, JUDGES_DEMO_FOLDER), JUDGES_DEMO_FILES.narration).writeSync(
      JSON.stringify(report),
    );
  } catch {
    // The page only goes quiet; the guide keeps playing on the phone.
  }
}

/** Reports what the player plays to the judges' demo page until the returned function stops it. */
export function mirrorToDemoPage(uri: string, player: Pick<AudioHandle, "addListener">): () => void {
  const source = demoSource(uri);
  let last: DemoNarration | undefined;
  const subscription = player.addListener("playbackStatusUpdate", (status) => {
    const report = nextReport(last, source, status, Date.now());
    if (!report) return;
    last = report;
    write(report);
  });
  return () => {
    subscription.remove();
    write({ source: null, playing: false, position: 0, rate: 1, at: Date.now() });
  };
}
