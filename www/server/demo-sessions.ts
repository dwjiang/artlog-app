import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

import { type Limrun, type Ios } from "@limrun/api";

import { JUDGES_DEMO_FILES, JUDGES_DEMO_FOLDER } from "../../shared/capture/judges-demo.ts";

const BUNDLE_ID = "app.artlog.ios";
export const DEMO_LABEL = "artlog-judges-demo";
// The Met, so the app offers nearby museums the way it would in a gallery.
const LOCATION = "40.7794,-73.9632";
// Granted up front so setup asks no system questions; Photos add-only otherwise interrupts onboarding.
const PERMISSIONS = ["photos", "photos-add", "location", "camera"];
const LIVE_STATES = new Set(["creating", "assigned", "ready"]);
const DAY_MS = 24 * 60 * 60 * 1000;

type IosInstance = Awaited<ReturnType<Limrun["iosInstances"]["create"]>>;
type Instances = Pick<Limrun["iosInstances"], "create" | "list" | "get" | "delete">;
type DeviceClient = Pick<Ios.InstanceClient, "pushFile" | "simctl" | "launchApp" | "disconnect">;

export type DemoConfig = {
  appAsset: string;
  /** Copied as-is into the app's demo folder on every phone: the viewfinder video and its gallery photos. */
  phoneDir: string;
  accessCode?: string;
  maxLive: number;
  maxPerDay: number;
  maxUploads: number;
};

export type DemoSession = { id: string; endpointWebSocketUrl: string; streamToken: string };

/** File extension for the image formats the app imports, from the file's leading bytes. */
export function imageExtension(bytes: Uint8Array): "jpg" | "png" | "heic" | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (ascii(1, 4) === "PNG" && bytes[0] === 0x89) return "png";
  if (ascii(4, 8) === "ftyp" && ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(ascii(8, 12))) {
    return "heic";
  }
}

export class DemoError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createDemoSessions(
  config: DemoConfig,
  instances: Instances,
  connect: (apiUrl: string, token: string) => Promise<DeviceClient>,
) {
  async function ours(): Promise<IosInstance[]> {
    const found: IosInstance[] = [];
    for await (const instance of instances.list({ labelSelector: `managed_by=${DEMO_LABEL}` })) {
      found.push(instance);
    }
    return found;
  }

  let admission = Promise.resolve();
  const unlistedStarts = new Map<string, number>();

  async function reserveStart(): Promise<string> {
    const previous = admission;
    let release!: () => void;
    admission = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const found = await ours();
      const since = Date.now() - DAY_MS;
      // Keep reservations until a list response sees their labels: creation can finish while that list is in flight.
      for (const instance of found) unlistedStarts.delete(instance.metadata.labels?.session ?? "");
      for (const [session, createdAt] of unlistedStarts) {
        if (createdAt <= since) unlistedStarts.delete(session);
      }
      if (found.filter((i) => LIVE_STATES.has(i.status.state)).length + unlistedStarts.size >= config.maxLive) {
        throw new DemoError(429, "busy", "All demo phones are in use. Try again in a few minutes.");
      }
      if (
        found.filter((i) => Date.parse(i.metadata.createdAt) > since).length + unlistedStarts.size
        >= config.maxPerDay
      ) {
        throw new DemoError(429, "daily_cap", "Today's demo phones are used up. Try again tomorrow.");
      }
      const session = randomUUID();
      unlistedStarts.set(session, Date.now());
      return session;
    } finally {
      release();
    }
  }

  async function withDevice<T>(instance: IosInstance, task: (client: DeviceClient) => Promise<T>): Promise<T> {
    const { apiUrl, token } = instance.status;
    if (!apiUrl || !token) throw new Error("Instance is missing its control endpoint");
    const client = await connect(apiUrl, token);
    try {
      return await task(client);
    } finally {
      client.disconnect();
    }
  }

  const pushToApp = (client: DeviceClient, source: string, path: string) =>
    client.pushFile(source, `Documents/${JUDGES_DEMO_FOLDER}/${path}`, { bundleId: BUNDLE_ID, containerType: "data" });

  async function prepare(instance: IosInstance): Promise<void> {
    await withDevice(instance, async (client) => {
      const run = async (args: string[]) => {
        const { code, stderr } = await client.simctl(args).wait();
        if (code !== 0) throw new Error(`simctl ${args[0]} exited ${code}: ${stderr.trim()}`);
      };
      const files = await readdir(config.phoneDir, { recursive: true, withFileTypes: true });
      await Promise.all(
        files
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const source = join(entry.parentPath, entry.name);
            return pushToApp(client, source, relative(config.phoneDir, source));
          }),
      );
      await run(["location", "booted", "set", LOCATION]);
      for (const permission of PERMISSIONS) await run(["privacy", "booted", "grant", permission, BUNDLE_ID]);
      await client.launchApp(BUNDLE_ID);
    });
  }

  async function start({ code, clientIp }: { code?: string; clientIp?: string }): Promise<DemoSession> {
    if (config.accessCode && code?.trim() !== config.accessCode) {
      throw new DemoError(401, "access_code", "Enter the access code from the submission.");
    }
    const session = await reserveStart();
    const instance = await instances
      .create({
        wait: true,
        metadata: { labels: { managed_by: DEMO_LABEL, session }, displayName: "Artlog demo" },
        spec: {
          model: "iphone",
          inactivityTimeout: "10m",
          hardTimeout: "30m",
          clues: clientIp ? [{ kind: "ClientIP", clientIp }] : [],
          initialAssets: [{ kind: "App", source: "AssetName", assetName: config.appAsset }],
        },
      })
      .catch((error: unknown) => {
        unlistedStarts.delete(session);
        throw error;
      });
    try {
      await prepare(instance);
    } catch (error) {
      await instances.delete(instance.metadata.id).catch(() => undefined);
      throw error;
    }
    const { endpointWebSocketUrl, streamToken } = instance.status;
    if (!endpointWebSocketUrl || !streamToken) throw new Error("Instance is missing its stream endpoint");
    return { id: instance.metadata.id, endpointWebSocketUrl, streamToken };
  }

  // Only demo phones can be reached from the page.
  async function demoInstance(id: string): Promise<IosInstance> {
    const instance = await instances.get(id).catch(() => null);
    if (instance?.metadata.labels?.managed_by !== DEMO_LABEL) {
      throw new DemoError(404, "not_found", "Session not found.");
    }
    return instance;
  }

  async function stop(id: string): Promise<void> {
    const instance = await demoInstance(id);
    if (instance.status.state !== "terminated") await instances.delete(id);
  }

  async function readyInstance(id: string): Promise<IosInstance> {
    const instance = await demoInstance(id);
    if (instance.status.state !== "ready") throw new DemoError(409, "not_ready", "This session has ended.");
    return instance;
  }

  async function pushBytes(instance: IosInstance, bytes: Uint8Array | string, path: string): Promise<void> {
    const folder = await mkdtemp(join(tmpdir(), "artlog-push-"));
    try {
      const file = join(folder, basename(path));
      await writeFile(file, bytes);
      await withDevice(instance, (client) => pushToApp(client, file, path));
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  const uploads = new Map<string, number>();

  /** Adds a judge's own photo to the demo's photo picker on their phone. */
  async function upload(id: string, bytes: Uint8Array): Promise<void> {
    const extension = imageExtension(bytes);
    if (!extension) throw new DemoError(415, "not_an_image", "Upload a JPEG, PNG or HEIC photo.");
    const instance = await readyInstance(id);
    const count = (uploads.get(id) ?? 0) + 1;
    if (count > config.maxUploads) {
      throw new DemoError(429, "upload_cap", `A session takes up to ${config.maxUploads} photos.`);
    }
    uploads.set(id, count);
    // Named by time, so the picker lists the newest first.
    await pushBytes(instance, bytes, `${JUDGES_DEMO_FILES.uploads}/${Date.now()}-${count}.${extension}`);
  }

  /** Points the phone's Scan viewfinder at a painting, by its index in the viewfinder manifest. */
  async function walk(id: string, painting: number): Promise<void> {
    if (!Number.isInteger(painting) || painting < 0) {
      throw new DemoError(400, "unknown_painting", "Pick one of the paintings.");
    }
    await pushBytes(await readyInstance(id), JSON.stringify({ painting }), JUDGES_DEMO_FILES.walk);
  }

  return { start, stop, upload, walk, codeRequired: Boolean(config.accessCode) };
}

export type DemoSessions = ReturnType<typeof createDemoSessions>;
