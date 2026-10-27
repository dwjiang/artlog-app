/** Folder in the app's Documents where the judges' demo host copies `www/media/phone/` and the judges' uploads. */
export const JUDGES_DEMO_FOLDER = "judges-demo";
/** Names inside that folder, as `www/scripts/render-viewfinder.py` writes them. */
export const JUDGES_DEMO_FILES = {
  /** The viewfinder video: an idle loop, then one walk up to each painting. */
  video: "viewfinder.mp4",
  /** Where each segment of the video starts and ends, and each painting's title and thumbnail. */
  manifest: "viewfinder.json",
  /** Gallery stills offered for import. */
  photos: "photos",
  /** Photos judges upload from the demo page. */
  uploads: "uploads",
} as const;
