import { Directory, File, Paths } from "expo-file-system";

import { JUDGES_DEMO_FILES, JUDGES_DEMO_FOLDER } from "@/shared/capture/judges-demo";

/** A stretch of the video, in seconds. */
export type VideoSegment = { start: number; end: number };
export type DemoPainting = { title: string; artist: string; thumbnail: string; walk: VideoSegment };
export type DemoVideo = { uri: string; idle: VideoSegment; paintings: DemoPainting[] };

/** The gallery video the judges' demo host copied in, or undefined before it has or when its manifest is unusable. */
export function findDemoVideo(): DemoVideo | undefined {
  const folder = new Directory(Paths.document, JUDGES_DEMO_FOLDER);
  const video = new File(folder, JUDGES_DEMO_FILES.video);
  const manifest = new File(folder, JUDGES_DEMO_FILES.manifest);
  if (!video.exists || !manifest.exists) return undefined;
  try {
    return parseManifest(JSON.parse(manifest.textSync()), video.uri, folder);
  } catch {
    return undefined;
  }
}

function parseManifest(value: unknown, uri: string, folder: Directory): DemoVideo | undefined {
  const { idle, paintings } = (value ?? {}) as { idle?: unknown; paintings?: unknown };
  const idleSegment = segment(idle);
  if (!idleSegment || !Array.isArray(paintings) || paintings.length === 0) return undefined;
  const parsed: DemoPainting[] = [];
  for (const entry of paintings as unknown[]) {
    const { title, artist, thumbnail, walk } = (entry ?? {}) as Record<string, unknown>;
    const walkSegment = segment(walk);
    if (typeof title !== "string" || typeof artist !== "string" || typeof thumbnail !== "string" || !walkSegment) {
      return undefined;
    }
    parsed.push({ title, artist, thumbnail: new File(folder, thumbnail).uri, walk: walkSegment });
  }
  return { uri, idle: idleSegment, paintings: parsed };
}

function segment(value: unknown): VideoSegment | undefined {
  const { start, end } = (value ?? {}) as { start?: unknown; end?: unknown };
  if (typeof start !== "number" || typeof end !== "number" || !(start >= 0 && end > start)) return undefined;
  return { start, end };
}
