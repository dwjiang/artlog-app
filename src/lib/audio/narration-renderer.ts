import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { getNetworkStateAsync } from "expo-network";
import { fetch } from "expo/fetch";

import { removeFileIfExists } from "@/lib/files/remove-file";
import { OfflineError } from "@/lib/network-error";
import { isOffline } from "@/lib/network-state";
import { GUIDE_SECTIONS, validateGuide } from "@/shared/audio/guide";

import type { FactChip, GuideSentence } from "../../../convex/lib/validators";
import type { ListeningTrack } from "./narration";
import type { NarrationPreparationStage } from "./narration-preparation";

type Rendered = { uri: string; sentences: GuideSentence[]; renderId: string; live: boolean };
type Research = { facts: FactChip[]; researchUpdatedAt?: number };
type Generate = (args: { artworkId: ListeningTrack["work"]["artworkId"] }) => Promise<Rendered & Research>;

// A finished guide is about 1 MB, which museum cellular can take minutes to deliver; only silence means a stall.
const DOWNLOAD_IDLE_MS = 30_000;
const DOWNLOAD_LIMIT_MS = 3 * 60_000;
const SECTIONS: ReadonlySet<unknown> = new Set(GUIDE_SECTIONS);

function cacheDirectory() {
  return new Directory(Paths.cache, "narration");
}

// Files are named by the server's render id, so a re-rendered narration never collides with the old one.
export async function cachedNarrationUri(renderId: string) {
  const file = new File(cacheDirectory(), `${renderId}.mp3`);
  return file.exists && file.size > 0 ? file.uri : undefined;
}

// The server enforces the script's content rules, which can change after this build ships; the app only
// needs lines it can show and follow.
function guideScript(value: unknown): GuideSentence[] | null {
  return Array.isArray(value)
    && value.length > 0
    && value.every(
      (line) =>
        typeof line?.sentence === "string"
        && Array.isArray(line.factIds)
        && line.factIds.every((id: unknown) => typeof id === "string")
        && SECTIONS.has(line.section),
    )
    ? value
    : null;
}

async function offline() {
  try {
    return isOffline(await getNetworkStateAsync());
  } catch {
    return false; // An unknown connection is left to the request itself.
  }
}

/** Keeps the network-failure message the listener sees, plus what an event needs to tell a stalled server apart. */
export class DownloadTimeoutError extends Error {
  constructor(
    readonly timeout: "idle" | "limit",
    readonly receivedKb: number,
    readonly expectedKb: number | null,
  ) {
    super("Network request timed out");
    this.name = "DownloadTimeoutError";
  }
}

async function download(uri: string, cancel: AbortSignal): Promise<Uint8Array> {
  const transfer = new AbortController();
  let timedOut: "idle" | "limit" | undefined;
  const expire = (reason: "idle" | "limit") => () => {
    timedOut = reason;
    transfer.abort();
  };
  const stop = () => transfer.abort();
  cancel.addEventListener("abort", stop);
  let idle = setTimeout(expire("idle"), DOWNLOAD_IDLE_MS);
  const limit = setTimeout(expire("limit"), DOWNLOAD_LIMIT_MS);
  const progressed = () => {
    clearTimeout(idle);
    idle = setTimeout(expire("idle"), DOWNLOAD_IDLE_MS);
  };
  let length = 0;
  let expected: number | null = null;
  try {
    const response = await fetch(uri, { signal: transfer.signal });
    // The declared length only sizes a timeout report, so a response without headers still downloads.
    const declared = Number(response.headers?.get("content-length"));
    expected = Number.isFinite(declared) && declared > 0 ? declared : null;
    const reader = response.ok ? response.body?.getReader() : undefined;
    if (!reader) throw new Error(`Narration download failed with HTTP ${response.status}`);
    const chunks: Uint8Array[] = [];
    for (;;) {
      progressed();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.byteLength;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    if (cancel.aborted) throw new Error("Narration cancelled.");
    if (timedOut) {
      throw new DownloadTimeoutError(
        timedOut,
        Math.round(length / 1024),
        expected === null ? null : Math.round(expected / 1024),
      );
    }
    throw error;
  } finally {
    clearTimeout(idle);
    clearTimeout(limit);
    cancel.removeEventListener("abort", stop);
  }
}

export function createNarrationRenderer(generate: Generate) {
  let pending: AbortController | undefined;
  return {
    cancel() {
      pending?.abort();
    },
    invalidate(renderId: string) {
      const directory = cacheDirectory();
      removeFileIfExists(new File(directory, `${renderId}.mp3`));
      removeFileIfExists(new File(directory, `${renderId}.json`));
    },
    async render(
      track: ListeningTrack,
      onStage?: (stage: NarrationPreparationStage) => void,
    ): Promise<Rendered & Partial<Research>> {
      pending?.abort();
      const request = new AbortController();
      pending = request;
      const directory = cacheDirectory();
      directory.create({ intermediates: true, idempotent: true });
      const local = (renderId: string, facts: FactChip[]): Rendered | undefined => {
        const factIds = new Set(facts.map((fact) => fact.id));
        const file = new File(directory, `${renderId}.mp3`);
        const transcript = new File(directory, `${renderId}.json`);
        if (!file.exists || file.size === 0 || !transcript.exists) return undefined;
        try {
          const saved: unknown = JSON.parse(transcript.textSync());
          // The render id names one script, so its saved opening is checked as written rather than against the
          // track's, which goes stale when the work's title or date is corrected after it was queued.
          const opening = Array.isArray(saved) ? saved[0]?.sentence : undefined;
          const sentences = typeof opening === "string" ? validateGuide(saved, factIds, opening) : null;
          return sentences ? { uri: file.uri, sentences, renderId, live: false } : undefined;
        } catch {
          return undefined; /* A missing or damaged transcript is downloaded with its audio again. */
        }
      };
      if (request.signal.aborted) throw new Error("Narration cancelled.");
      const known = track.work.renderId ? local(track.work.renderId, track.work.facts) : undefined;
      if (known) return known;
      // Convex queues an action until it reconnects, which would leave the guide preparing indefinitely.
      if (await offline()) throw new OfflineError();
      if (request.signal.aborted) throw new Error("Narration cancelled.");
      onStage?.("generating");
      const audio = await generate({ artworkId: track.work.artworkId });
      if (request.signal.aborted) throw new Error("Narration cancelled.");
      // A first play researches the work, so the guide's facts come from the render rather than the track.
      const research = { facts: audio.facts, researchUpdatedAt: audio.researchUpdatedAt };
      const sentences = guideScript(audio.sentences);
      if (!sentences) throw new Error("Narration transcript is invalid.");
      // Speech still being generated plays from its playlist; a later play downloads the finished file.
      if (audio.live) return { ...audio, sentences };
      const downloaded = local(audio.renderId, audio.facts);
      if (downloaded) return { ...downloaded, ...research };
      onStage?.("downloading");
      const file = new File(directory, `${audio.renderId}.mp3`);
      const transcript = new File(directory, `${audio.renderId}.json`);
      const partial = new File(directory, `${audio.renderId}-${randomUUID()}.partial`);
      try {
        const bytes = await download(audio.uri, request.signal);
        if (request.signal.aborted) throw new Error("Narration cancelled.");
        if (bytes.length === 0) throw new Error("Narration audio is empty.");
        partial.writeSync(bytes);
        removeFileIfExists(file);
        await partial.move(file);
        transcript.writeSync(JSON.stringify(sentences));
        if (request.signal.aborted) throw new Error("Narration cancelled.");
        return { uri: file.uri, sentences, renderId: audio.renderId, live: false, ...research };
      } finally {
        if (partial.uri !== file.uri) removeFileIfExists(partial);
      }
    },
  };
}
