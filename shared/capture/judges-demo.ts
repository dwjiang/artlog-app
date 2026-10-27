/** Folder in the app's Documents where the judges' demo host copies `www/media/phone/` and the judges' uploads. */
export const JUDGES_DEMO_FOLDER = "judges-demo";
/** Names inside that folder. */
export const JUDGES_DEMO_FILES = {
  /** The viewfinder video, from `www/scripts/render-viewfinder.py`: an idle loop, then one walk up to each painting. */
  video: "viewfinder.mp4",
  /** Where each segment of the video starts and ends, and each painting's title and thumbnail for the demo page. */
  manifest: "viewfinder.json",
  /**
   * The painting the demo page last asked the viewfinder to walk up to. The app opens Scan when one is written and
   * deletes it once it walks there.
   */
  walk: "walk.json",
  /** Gallery stills offered for import. */
  photos: "photos",
  /** Photos judges upload from the demo page. */
  uploads: "uploads",
  /** The app's {@link DemoNarration}, which the demo page plays aloud because the cloud iPhone streams no sound. */
  narration: "narration.json",
} as const;

/** What the app's audio guide is playing, rewritten whenever it stops matching what the last report predicts. */
export type DemoNarration = {
  /** The narration playlist URL, or a cached narration's path inside the app's data container; null once stopped. */
  source: string | null;
  playing: boolean;
  /** Seconds into the narration at `at`. */
  position: number;
  rate: number;
  /** Epoch milliseconds. */
  at: number;
};
