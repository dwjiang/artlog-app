import { type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { DemoError, type DemoSessions } from "./demo-sessions.ts";
import { pageNarration, proxyNarration } from "./narration.ts";
import { MAX_UPLOAD_BYTES } from "./upload-limit.ts";

export const DEMO_BASE = "/demo/";
const API_ROOT = `${DEMO_BASE}api`;

const PRIVATE_IP = /^(::1|::ffff:127\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  if (body === undefined) return void res.end();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of requestBody(req)) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new DemoError(413, "too_large", `Photos can be up to ${limit / 1024 / 1024} MB.`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of requestBody(req)) {
    text += chunk;
    if (text.length > 10_000) throw new DemoError(413, "too_large", "Request too large.");
  }
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

function requestBody(req: IncomingMessage): Readable {
  // Vercel replays data/end events on an already-consumed request; wrap them in fresh stream state for iteration.
  return new Readable().wrap(req);
}

// A public client IP places the phone in the region nearest the visitor.
function clientIp(req: IncomingMessage): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  const ip = first || req.socket.remoteAddress;
  return ip && !PRIVATE_IP.test(ip) ? ip : undefined;
}

async function relay(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  // Playlists and two-second segments are small enough to buffer.
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Connect-style middleware for the page's API, shared by `vite dev`, `vite preview` and the Vercel Function.
 * `narrationSite` is the Convex site of the backend the demo app build uses.
 */
export function createDemoApi(sessions: DemoSessions, narrationSite: string) {
  async function streamNarration(res: ServerResponse, id: string) {
    const stop = await sessions.watchNarration(id, (state) => {
      res.write(`data: ${JSON.stringify(pageNarration(state, id, narrationSite, Date.now()))}\n\n`);
    });
    if (res.destroyed) return stop();
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    res.flushHeaders();
    res.once("close", stop);
  }

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const { pathname: fullPath, search } = new URL(req.url ?? "", "http://localhost");
    if (!fullPath.startsWith(`${API_ROOT}/`)) return next();
    const path = fullPath.slice(API_ROOT.length);
    try {
      if (req.method === "GET" && path === "/config") {
        return send(res, 200, { codeRequired: sessions.codeRequired });
      }
      if (req.method === "POST" && path === "/sessions") {
        const { code } = await readJson(req);
        const session = await sessions.start({
          code: typeof code === "string" ? code : undefined,
          clientIp: clientIp(req),
        });
        const discard = () =>
          sessions.stop(session.id).catch((error: unknown) => {
            console.error("demo abandoned session cleanup failed", error);
          });
        if (res.destroyed) {
          await discard();
          return;
        }
        res.once("close", () => {
          if (!res.writableFinished) void discard();
        });
        return send(res, 200, session);
      }
      const stop = /^\/sessions\/([\w-]+)\/stop$/.exec(path);
      if (req.method === "POST" && stop?.[1]) {
        await sessions.stop(stop[1]);
        return send(res, 204);
      }
      const photos = /^\/sessions\/([\w-]+)\/photos$/.exec(path);
      if (req.method === "POST" && photos?.[1]) {
        await sessions.upload(photos[1], await readBytes(req, MAX_UPLOAD_BYTES));
        return send(res, 204);
      }
      const walk = /^\/sessions\/([\w-]+)\/walk$/.exec(path);
      if (req.method === "POST" && walk?.[1]) {
        const { painting } = await readJson(req);
        await sessions.walk(walk[1], typeof painting === "number" ? painting : Number.NaN);
        return send(res, 204);
      }
      const narration = /^\/sessions\/([\w-]+)\/narration$/.exec(path);
      if (req.method === "GET" && narration?.[1]) return await streamNarration(res, narration[1]);
      const cached = /^\/sessions\/([\w-]+)\/narration\/([\w-]+)\.mp3$/.exec(path);
      if (req.method === "GET" && cached?.[1] && cached[2]) {
        const bytes = await sessions.narrationFile(cached[1], cached[2]);
        res.setHeader("Content-Type", "audio/mpeg");
        return void res.end(bytes);
      }
      const proxied = /^\/narration\/(playlist|file)$/.exec(path);
      if (req.method === "GET" && (proxied?.[1] === "playlist" || proxied?.[1] === "file")) {
        return await relay(res, await proxyNarration(proxied[1], search, narrationSite));
      }
      next();
    } catch (error) {
      if (error instanceof DemoError) return send(res, error.status, { code: error.code, message: error.message });
      console.error("demo api failed", req.method, path, error);
      const message = path.endsWith("/photos")
        ? "The photo could not reach your iPhone. Try again."
        : path.endsWith("/walk")
          ? "Your iPhone could not be reached. Try again."
          : "The demo phone could not start. Try again in a minute.";
      send(res, 500, { code: "failed", message });
    }
  };
}
