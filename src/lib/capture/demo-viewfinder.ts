import { Directory, File, Paths } from "expo-file-system";

import { JUDGES_DEMO_FILES, JUDGES_DEMO_FOLDER } from "@/shared/capture/judges-demo";

/** A stretch of the video, in seconds. */
export type VideoSegment = { start: number; end: number };
/** `walks` holds one segment per painting, in the order the demo page lists them. */
export type DemoVideo = { uri: string; idle: VideoSegment; walks: VideoSegment[] };

/** How often the app checks for a painting picked on the demo page. */
export const WALK_REQUEST_POLL_MS = 250;

const folder = () => new Directory(Paths.document, JUDGES_DEMO_FOLDER);

/** The gallery video the judges' demo host copied in, or undefined before it has or when its manifest is unusable. */
export function findDemoVideo(): DemoVideo | undefined {
  const video = new File(folder(), JUDGES_DEMO_FILES.video);
  const manifest = new File(folder(), JUDGES_DEMO_FILES.manifest);
  if (!video.exists || !manifest.exists) return undefined;
  try {
    return parseManifest(JSON.parse(manifest.textSync()), video.uri);
  } catch {
    return undefined;
  }
}

function parseManifest(value: unknown, uri: string): DemoVideo | undefined {
  const { idle, paintings } = (value ?? {}) as { idle?: unknown; paintings?: unknown };
  const idleSegment = segment(idle);
  if (!idleSegment || !Array.isArray(paintings) || paintings.length === 0) return undefined;
  const walks: VideoSegment[] = [];
  for (const entry of paintings as unknown[]) {
    const walk = segment(((entry ?? {}) as { walk?: unknown }).walk);
    if (!walk) return undefined;
    walks.push(walk);
  }
  return { uri, idle: idleSegment, walks };
}

function segment(value: unknown): VideoSegment | undefined {
  const { start, end } = (value ?? {}) as { start?: unknown; end?: unknown };
  if (typeof start !== "number" || typeof end !== "number" || !(start >= 0 && end > start)) return undefined;
  return { start, end };
}

/** When the demo page wrote the walk request still waiting to be taken, in epoch milliseconds, or undefined. */
export function walkRequestTime(): number | undefined {
  const file = new File(folder(), JUDGES_DEMO_FILES.walk);
  return file.exists ? (file.modificationTime ?? undefined) : undefined;
}

/**
 * Takes the painting the demo page asked the viewfinder to walk up to since the last call, as an index into `walks`.
 * A request is used up once read; one still being written stays for the next call.
 */
export function takeWalkRequest(walks: number): number | undefined {
  const file = new File(folder(), JUDGES_DEMO_FILES.walk);
  if (!file.exists) return undefined;
  let painting: unknown;
  try {
    ({ painting } = JSON.parse(file.textSync()) as { painting?: unknown });
  } catch {
    return undefined;
  }
  file.delete();
  return typeof painting === "number" && Number.isInteger(painting) && painting >= 0 && painting < walks
    ? painting
    : undefined;
}
