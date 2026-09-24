import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { fetch } from "expo/fetch";

import { validateGuide } from "@/shared/audio/guide";

import type { DocentSentence } from "../../../convex/lib/validators";
import type { ListeningTrack } from "./narration";

type Rendered = { uri: string; sentences: DocentSentence[]; renderId: string };
type Generate = (args: { artworkId: ListeningTrack["work"]["artworkId"] }) => Promise<Rendered>;

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
    async render(track: ListeningTrack): Promise<Rendered> {
      pending?.abort();
      const request = new AbortController();
      pending = request;
      const factIds = new Set(track.work.facts.map((fact) => fact.id));
      const { opening } = track.work;
      const directory = cacheDirectory();
      directory.create({ intermediates: true, idempotent: true });
      const local = (renderId: string): Rendered | undefined => {
        const file = new File(directory, `${renderId}.mp3`);
        const transcript = new File(directory, `${renderId}.json`);
        if (!file.exists || file.size === 0 || !transcript.exists) return undefined;
        try {
          const sentences = validateGuide(JSON.parse(transcript.textSync()), factIds, opening);
          return sentences ? { uri: file.uri, sentences, renderId } : undefined;
        } catch {
          return undefined; /* A missing or damaged transcript is downloaded with its audio again. */
        }
      };
      if (request.signal.aborted) throw new Error("Narration cancelled.");
      const known = track.work.renderId ? local(track.work.renderId) : undefined;
      if (known) return known;
      const audio = await generate({ artworkId: track.work.artworkId });
      if (request.signal.aborted) throw new Error("Narration cancelled.");
      const sentences = validateGuide(audio.sentences, factIds, opening);
      if (!sentences) throw new Error("Narration transcript is invalid.");
      const downloaded = local(audio.renderId);
      if (downloaded) return downloaded;
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
        if (file.exists) file.delete();
        await partial.move(file);
        transcript.write(JSON.stringify(sentences));
        if (request.signal.aborted) throw new Error("Narration cancelled.");
        return { uri: file.uri, sentences, renderId: audio.renderId };
      } finally {
        clearTimeout(timeout);
        if (partial.exists && partial.uri !== file.uri) partial.delete();
      }
    },
  };
}
