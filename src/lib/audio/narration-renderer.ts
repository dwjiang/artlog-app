import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { fetch } from "expo/fetch";

import { removeFileIfExists } from "@/lib/files/remove-file";
import { validateGuide } from "@/shared/audio/guide";

import type { FactChip, GuideSentence } from "../../../convex/lib/validators";
import type { ListeningTrack } from "./narration";
import type { NarrationPreparationStage } from "./narration-preparation";

type Rendered = { uri: string; sentences: GuideSentence[]; renderId: string; live: boolean };
type Research = { facts: FactChip[]; researchUpdatedAt?: number };
type Generate = (args: { artworkId: ListeningTrack["work"]["artworkId"] }) => Promise<Rendered & Research>;

function cacheDirectory() {
  return new Directory(Paths.cache, "narration");
}

// Files are named by the server's render id, so a re-rendered narration never collides with the old one.
export async function cachedNarrationUri(renderId: string) {
  const file = new File(cacheDirectory(), `${renderId}.mp3`);
  return file.exists && file.size > 0 ? file.uri : undefined;
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
      const { opening } = track.work;
      const directory = cacheDirectory();
      directory.create({ intermediates: true, idempotent: true });
      const local = (renderId: string, facts: FactChip[]): Rendered | undefined => {
        const factIds = new Set(facts.map((fact) => fact.id));
        const file = new File(directory, `${renderId}.mp3`);
        const transcript = new File(directory, `${renderId}.json`);
        if (!file.exists || file.size === 0 || !transcript.exists) return undefined;
        try {
          const sentences = validateGuide(JSON.parse(transcript.textSync()), factIds, opening);
          return sentences ? { uri: file.uri, sentences, renderId, live: false } : undefined;
        } catch {
          return undefined; /* A missing or damaged transcript is downloaded with its audio again. */
        }
      };
      if (request.signal.aborted) throw new Error("Narration cancelled.");
      const known = track.work.renderId ? local(track.work.renderId, track.work.facts) : undefined;
      if (known) return known;
      onStage?.("generating");
      const audio = await generate({ artworkId: track.work.artworkId });
      if (request.signal.aborted) throw new Error("Narration cancelled.");
      // A first play researches the work, so the guide's facts come from the render rather than the track.
      const research = { facts: audio.facts, researchUpdatedAt: audio.researchUpdatedAt };
      const sentences = validateGuide(audio.sentences, new Set(audio.facts.map((fact) => fact.id)), opening);
      if (!sentences) throw new Error("Narration transcript is invalid.");
      // Speech still being generated plays from its playlist; a later play downloads the finished file.
      if (audio.live) return { ...audio, sentences };
      const downloaded = local(audio.renderId, audio.facts);
      if (downloaded) return { ...downloaded, ...research };
      onStage?.("downloading");
      const file = new File(directory, `${audio.renderId}.mp3`);
      const transcript = new File(directory, `${audio.renderId}.json`);
      const timeout = setTimeout(() => request.abort(), 30_000);
      const partial = new File(directory, `${audio.renderId}-${randomUUID()}.partial`);
      try {
        const response = await fetch(audio.uri, { signal: request.signal });
        if (!response.ok) throw new Error("Narration download failed.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (request.signal.aborted) throw new Error("Narration cancelled.");
        if (bytes.length === 0) throw new Error("Narration audio is empty.");
        partial.write(bytes);
        removeFileIfExists(file);
        await partial.move(file);
        transcript.write(JSON.stringify(sentences));
        if (request.signal.aborted) throw new Error("Narration cancelled.");
        return { uri: file.uri, sentences, renderId: audio.renderId, live: false, ...research };
      } finally {
        clearTimeout(timeout);
        if (partial.uri !== file.uri) removeFileIfExists(partial);
      }
    },
  };
}
