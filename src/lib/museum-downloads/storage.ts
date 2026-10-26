import type { FunctionReturnType } from "convex/server";
import { jsonToConvex } from "convex/values";
import { digest, CryptoDigestAlgorithm } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { getNetworkStateAsync } from "expo-network";
import { fetch } from "expo/fetch";

import { getSetting, setSetting } from "@/db/repos/settings";
import { convex } from "@/lib/convex-client";
import { isOffline } from "@/lib/network-state";
import model from "@/shared/model/model-version.json";
import type { MuseumEntry, MuseumSummary } from "@/shared/offline/types";

import { api } from "../../../convex/_generated/api";
import { MuseumDownloadsController, type DownloadDependencies } from "./controller";
import type { LocalPackage } from "./model";

const SETTING = "museumDownloads";
export const packageDirectory = (folder: string) => new Directory(Paths.document, "museum-downloads", folder);
const partFile = (pack: LocalPackage, index: number) => new File(packageDirectory(pack.folder), `${index}.json`);
export async function readEntries(pack: LocalPackage, index: number): Promise<MuseumEntry[]> {
  return jsonToConvex(JSON.parse(await partFile(pack, index).text())) as unknown as MuseumEntry[];
}
export function previewUri(pack: LocalPackage | undefined, index: number): string | undefined {
  if (!pack) return;
  const file = new File(packageDirectory(pack.folder), `preview-${index}`);
  return file.exists ? file.uri : undefined;
}
const removePackage = (folder: string) => {
  const directory = packageDirectory(folder);
  if (directory.exists) directory.delete();
};
async function download(url: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (signal.aborted) throw new Error("Download paused");
  if (Paths.availableDiskSpace < bytes.byteLength + 1_000_000) {
    throw new Error("space");
  }
  return bytes;
}
const deps: DownloadDependencies = {
  async read() {
    const value = await getSetting(SETTING);
    if (!value) return;
    const saved: Awaited<ReturnType<DownloadDependencies["read"]>> = JSON.parse(value);
    if (!saved) return;
    for (const [id, row] of Object.entries(saved.downloads)) {
      if (
        row.active
        && (row.active.manifest.modelVersion !== model.modelVersion
          || !row.active.manifest.chunks.every((_, index) => partFile(row.active!, index).exists))
      ) {
        removePackage(row.active.folder);
        row.active = undefined;
        row.status = "paused";
        row.error = "unavailable";
      }
      if (!row.active && !row.pending) delete saved.downloads[id];
    }
    return saved;
  },
  write: (value) => setSetting(SETTING, JSON.stringify(value)),
  async catalog() {
    const museums: MuseumSummary[] = [];
    let cursor: string | null = null;
    do {
      const result: FunctionReturnType<typeof api.museumDownloads.catalog> = await convex.query(
        api.museumDownloads.catalog,
        {
          paginationOpts: { cursor, numItems: 64 },
        },
      );
      museums.push(...result.page);
      if (result.isDone) return museums;
      cursor = result.continueCursor;
    } while (cursor);
    return museums;
  },
  manifest: (venueId) => convex.query(api.museumDownloads.get, { venueId }),
  online: async () => {
    const network = await getNetworkStateAsync();
    return !isOffline(network);
  },
  folder: (manifest) => `${manifest.id}-${manifest.version}`,
  async download(pack, index, signal) {
    const part = pack.manifest.chunks[index];
    const bytes = await download(part.url, signal);
    const hash = Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== part.sha256 || bytes.byteLength !== part.size) {
      throw new Error("Incomplete download");
    }
    if (signal.aborted) return;
    const directory = packageDirectory(pack.folder);
    directory.create({ intermediates: true, idempotent: true });
    partFile(pack, index).writeSync(bytes);
  },
  async previews(pack, signal) {
    for (const [index, preview] of pack.manifest.previews.entries()) {
      const file = new File(packageDirectory(pack.folder), `preview-${index}`);
      if (file.exists) continue;
      try {
        const bytes = await download(preview.url, signal);
        if (signal.aborted) return;
        file.writeSync(bytes);
      } catch (error) {
        // Museum image hosts refuse some requests; the detail view falls back to the remote URL, so a preview never blocks recognition.
        if (signal.aborted) throw error;
        console.warn("Museum preview unavailable", preview.url, error);
      }
    }
  },
  remove: removePackage,
  availableBytes: () => Paths.availableDiskSpace,
};
export const museumDownloads = new MuseumDownloadsController(deps);
