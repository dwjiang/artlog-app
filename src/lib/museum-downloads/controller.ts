import type { MuseumManifest, MuseumSummary } from "@/shared/offline/types";
import type { MuseumDownload, LocalPackage } from "./model";

export type DownloadSnapshot = {
  catalog: MuseumSummary[];
  downloads: Record<string, MuseumDownload>;
  loaded: boolean;
  loading: boolean;
  error?: string;
};
export type DownloadDependencies = {
  read(): Promise<Pick<DownloadSnapshot, "catalog" | "downloads"> | undefined>;
  write(snapshot: Pick<DownloadSnapshot, "catalog" | "downloads">): Promise<void>;
  catalog(): Promise<MuseumSummary[]>;
  manifest(id: MuseumSummary["id"]): Promise<MuseumManifest | null>;
  online(): Promise<boolean>;
  folder(manifest: MuseumManifest): string;
  download(pack: LocalPackage, index: number, signal: AbortSignal): Promise<void>;
  previews(pack: LocalPackage, signal: AbortSignal): Promise<void>;
  remove(folder: string): void;
  availableBytes(): number;
};
export class MuseumDownloadsController {
  private snapshot: DownloadSnapshot = {
    catalog: [],
    downloads: {},
    loaded: false,
    loading: false,
  };
  private listeners = new Set<() => void>();
  private jobs = new Map<string, AbortController>();
  private hydration?: Promise<void>;
  private writes = Promise.resolve();
  constructor(private deps: DownloadDependencies) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private async publish(fields: Partial<DownloadSnapshot>) {
    this.snapshot = { ...this.snapshot, ...fields };
    for (const listener of this.listeners) listener();
    const { catalog, downloads } = this.snapshot;
    const write = this.writes.catch(() => {}).then(() => this.deps.write({ catalog, downloads }));
    this.writes = write;
    await write;
  }
  private async row(id: string, value: MuseumDownload | undefined) {
    const downloads = { ...this.snapshot.downloads };
    if (value) downloads[id] = value;
    else delete downloads[id];
    await this.publish({ downloads });
  }
  hydrate = () =>
    (this.hydration ??= (async () => {
      const saved = await this.deps.read();
      if (saved) {
        for (const row of Object.values(saved.downloads)) {
          if (row.status === "downloading") row.status = "paused";
        }
        await this.publish({ ...saved, loaded: true });
      } else await this.publish({ loaded: true });
    })().catch((error) => {
      this.hydration = undefined;
      this.snapshot = {
        ...this.snapshot,
        loaded: true,
        error: "Couldn’t load downloads. Try again.",
      };
      for (const listener of this.listeners) listener();
      throw error;
    }));
  refresh = async () => {
    await this.hydrate();
    if (this.snapshot.loading) return;
    // Without this the first visit on a disconnected phone reads as "no museums exist" instead of "no signal".
    if (!(await this.deps.online())) {
      await this.publish({ error: "Connect to load museums." });
      return;
    }
    await this.publish({ loading: true, error: undefined });
    try {
      await this.publish({
        catalog: await this.deps.catalog(),
        loading: false,
      });
    } catch {
      await this.publish({
        loading: false,
        error: "Couldn’t load museums. Try again.",
      });
    }
  };
  start = async (museum: MuseumSummary): Promise<void> => {
    await this.hydrate();
    if (this.jobs.has(museum.id)) return;
    if (!(await this.deps.online())) throw new Error("Connect to download.");
    if (this.jobs.has(museum.id)) return;
    const abort = new AbortController();
    this.jobs.set(museum.id, abort);
    const current = () => this.jobs.get(museum.id) === abort && !abort.signal.aborted;
    let row = this.snapshot.downloads[museum.id] ?? {
      museum,
      status: "paused" as const,
      completed: 0,
    };
    try {
      await this.row(museum.id, {
        ...row,
        status: "downloading",
        error: undefined,
      });
      const manifest = await this.deps.manifest(museum.id);
      if (!current()) return;
      if (!manifest) throw new Error("unavailable");
      if (row.active?.manifest.version === manifest.version) {
        await this.row(museum.id, {
          ...row,
          status: "ready",
          error: undefined,
        });
        return;
      }
      if (row.pending?.manifest.version !== manifest.version) {
        if (row.pending) this.deps.remove(row.pending.folder);
        row = {
          ...row,
          museum: manifest,
          pending: { manifest, folder: this.deps.folder(manifest) },
          completed: 0,
        };
      } else row = { ...row, pending: { ...row.pending, manifest } };
      row = { ...row, status: "downloading", error: undefined };
      await this.row(museum.id, row);
      const remaining = manifest.chunks.slice(row.completed).reduce((sum, part) => sum + part.size, 0);
      if (this.deps.availableBytes() < remaining + 5_000_000) {
        throw new Error("space");
      }
      for (let index = row.completed; index < manifest.chunks.length; index++) {
        if (!current()) return;
        await this.deps.download(row.pending!, index, abort.signal);
        if (!current()) return;
        row = { ...row, completed: index + 1 };
        await this.row(museum.id, row);
      }
      await this.deps.previews(row.pending!, abort.signal);
      if (!current()) return;
      const previous = row.active;
      await this.row(museum.id, {
        museum: manifest,
        status: "ready",
        active: row.pending,
        completed: row.completed,
      });
      if (previous) this.deps.remove(previous.folder);
    } catch (cause) {
      if (!current()) return;
      console.warn("Museum download interrupted", cause);
      const message = cause instanceof Error ? cause.message : "";
      const error =
        message === "space" || message === "unavailable"
          ? message
          : !(await this.deps.online())
            ? "connection"
            : "failed";
      if (!current()) return;
      await this.row(museum.id, { ...row, status: "paused", error });
    } finally {
      if (this.jobs.get(museum.id) === abort) this.jobs.delete(museum.id);
    }
  };
  pause = async (id: string) => {
    this.jobs.get(id)?.abort();
    this.jobs.delete(id);
    const row = this.snapshot.downloads[id];
    if (row?.status === "downloading") {
      await this.row(id, { ...row, status: "paused" });
    }
  };
  pauseAll = async () => {
    for (const id of this.jobs.keys()) await this.pause(id);
  };
  cancel = async (id: string) => {
    await this.pause(id);
    const row = this.snapshot.downloads[id];
    if (row?.pending) this.deps.remove(row.pending.folder);
    await this.row(
      id,
      row?.active
        ? {
            museum: row.museum,
            active: row.active,
            status: "ready",
            completed: row.active.manifest.chunks.length,
          }
        : undefined,
    );
  };
  remove = async (id: string) => {
    await this.pause(id);
    const row = this.snapshot.downloads[id];
    await this.row(id, undefined);
    if (row?.active) this.deps.remove(row.active.folder);
    if (row?.pending) this.deps.remove(row.pending.folder);
  };
  checkForUpdate = async (museum: MuseumSummary): Promise<boolean> => {
    if (!(await this.deps.online())) {
      throw new Error("Connect to check for updates.");
    }
    const manifest = await this.deps.manifest(museum.id);
    if (!manifest) {
      throw new Error("This museum is no longer available to download.");
    }
    const changed = this.snapshot.downloads[museum.id]?.active?.manifest.version !== manifest.version;
    if (changed) await this.start(manifest);
    return changed;
  };
}
