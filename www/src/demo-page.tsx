import { defaultRemoteControlAssets, RemoteControl } from "@limrun/ui";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { MAX_UPLOAD_BYTES } from "../server/upload-limit.ts";
import { API } from "./api.ts";
import { PaintingPicker } from "./painting-picker.tsx";
import { usePhoneNarration } from "./phone-narration.ts";

const APP_STORE_URL = "https://apps.apple.com/app/id6815466893";
const REPO_URL = "https://github.com/dwjiang/artlog-app";
const MET_OPEN_ACCESS_URL = "https://www.metmuseum.org/art/collection";
// The app keeps library photos at this long side, so a smaller upload loses no detail it uses.
const UPLOAD_LONG_SIDE = 2560;

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

type Session = { id: string; endpointWebSocketUrl: string; streamToken: string };
type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "live"; session: Session }
  | { kind: "ended" }
  | { kind: "error"; message: string };
type Upload = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

function stopSession(id: string) {
  // keepalive lets the request finish while the tab closes, so the phone stops billing at once.
  void fetch(`${API}/sessions/${id}/stop`, { method: "POST", keepalive: true }).catch(() => undefined);
}

// Throws when the browser cannot decode the file, such as HEIC outside Safari.
async function fitForUpload(file: File): Promise<Blob> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, UPLOAD_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
}

export function DemoPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [codeRequired, setCodeRequired] = useState(false);
  const [code, setCode] = useState("");
  // One signaling session per page load; a new value would restart the stream.
  const [viewerId] = useState(() => `viewer-${crypto.randomUUID()}`);
  const liveId = phase.kind === "live" ? phase.session.id : undefined;
  const [upload, setUpload] = useState<Upload>({ kind: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);
  const narration = useRef<HTMLAudioElement>(null);
  usePhoneNarration(narration, liveId);

  useEffect(() => {
    void fetch(`${API}/config`)
      .then((res) => res.json() as Promise<{ codeRequired: boolean }>)
      .then((config) => setCodeRequired(config.codeRequired))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!liveId) return;
    const onPageHide = () => stopSession(liveId);
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [liveId]);

  async function start(event: FormEvent) {
    event.preventDefault();
    // Safari lets an element play sound later only once it has been played inside a tap.
    void narration.current?.play().catch(() => undefined);
    setPhase({ kind: "starting" });
    setUpload({ kind: "idle" });
    try {
      const res = await fetch(`${API}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json()) as Session & { message?: string };
      if (!res.ok) throw new Error(body.message ?? "The demo phone could not start.");
      setPhase({ kind: "live", session: body });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function sendPhoto(file: File | undefined) {
    if (!file || !liveId) return;
    setUpload({ kind: "sending" });
    try {
      const photo = await fitForUpload(file).catch(() => {
        throw new Error(`This photo is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Try a JPEG or a smaller photo.`);
      });
      const res = await fetch(`${API}/sessions/${liveId}/photos`, {
        method: "POST",
        headers: { "Content-Type": photo.type || "application/octet-stream" },
        body: photo,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "The photo could not reach your iPhone.");
      }
      setUpload({ kind: "sent" });
    } catch (error) {
      setUpload({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function end() {
    if (liveId) stopSession(liveId);
    setPhase({ kind: "ended" });
  }

  return (
    <main className="page">
      <audio ref={narration} />
      <section>
        <p className="wordmark">Artlog</p>
        <h1>Point at a painting. Learn its story.</h1>
        <p className="lede">
          Artlog is an iPhone app that names the painting in front of you, tells its story with sources, and reads it
          aloud. This cloud iPhone runs it on the App Store app&rsquo;s live backend; the tour takes about 3 minutes.
        </p>
        <ol className="steps">
          <li>
            <p>
              <strong id="scan-step">Scan a painting.</strong> Pick one. A video stands in for the camera and walks up
              to it; Artlog outlines and names it on its own.
            </p>
            <PaintingPicker sessionId={liveId} labelledBy="scan-step" />
            <p className="tech">
              <b>NVIDIA C-RADIOv3-B</b> runs on the iPhone and turns the painting into a fingerprint, matched against
              about 400,000 artworks. The scan sends no pixels.
            </p>
          </li>
          <li>
            <p>
              <strong>Read its story.</strong> Each sentence of About this work links to the page its fact came from.
            </p>
            <p className="tech">
              <b>Tavily</b> finds sources; on <b>Nebius Token Factory</b>, <b>Nemotron 3 Super</b> extracts quoted facts
              and <b>Nemotron 3.5 Lightning</b> writes from only those.
            </p>
          </li>
          <li>
            <p>
              <strong>Listen.</strong> Tap Play audio guide with your sound on; this page plays it.
            </p>
            <p className="tech">
              <b>Nemotron 3 Ultra</b> writes the guide from the same research, and the backend checks each
              sentence&rsquo;s evidence word for word. An <b>OpenAI</b> voice reads it.
            </p>
          </li>
          <li>
            <p>
              <strong>Try your own photo.</strong> Upload one, then tap Photos on the iPhone. No photo handy? Try{" "}
              <ExternalLink href={MET_OPEN_ACCESS_URL}>The Met&rsquo;s open-access collection</ExternalLink>.
            </p>
            <div className="upload">
              <button
                type="button"
                className="secondary"
                disabled={!liveId || upload.kind === "sending"}
                onClick={() => fileInput.current?.click()}
              >
                {upload.kind === "sending" ? "Sending…" : "Upload a photo"}
              </button>
              <span className="tech">Uploads go only to your demo iPhone.</span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/heic"
              hidden
              onChange={(event) => {
                void sendPhoto(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <p className="upload-status" role="status">
              {upload.kind === "sent"
                ? "Added. On the iPhone, tap Photos on the Scan tab; it’s under Your photos."
                : upload.kind === "error"
                  ? upload.message
                  : ""}
            </p>
          </li>
        </ol>
        <footer className="links">
          <ExternalLink href={REPO_URL}>Source on GitHub</ExternalLink>
          <ExternalLink href={`${REPO_URL}#how-it-works`}>How it works</ExternalLink>
          <ExternalLink href={APP_STORE_URL}>App Store</ExternalLink>
          {liveId && (
            <button type="button" className="text" onClick={end}>
              End session
            </button>
          )}
        </footer>
      </section>

      <section className="device" aria-label="Cloud iPhone">
        <div className="phone">
          {phase.kind === "live" ? (
            <RemoteControl
              url={phase.session.endpointWebSocketUrl}
              token={phase.session.streamToken}
              sessionId={viewerId}
              autoReconnect
              onTerminated={() => setPhase({ kind: "ended" })}
            />
          ) : (
            <>
              <img className="phone-frame" src={defaultRemoteControlAssets.ios?.frame} alt="" />
              <form className="launch" onSubmit={start}>
                <p className="status" role="status">
                  {phase.kind === "starting"
                    ? "Starting your iPhone. This takes about 20 seconds."
                    : phase.kind === "ended"
                      ? "Session ended."
                      : phase.kind === "error"
                        ? phase.message
                        : "Your own iPhone starts when you press Start."}
                </p>
                {codeRequired && (
                  <label className="code">
                    Access code
                    <input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" required />
                  </label>
                )}
                <button type="submit" disabled={phase.kind === "starting"}>
                  {phase.kind === "starting" ? "Starting…" : phase.kind === "idle" ? "Start" : "Start again"}
                </button>
                <p className="limits">
                  A session ends after 10 minutes without use, or after 30 minutes, and its iPhone is deleted.
                </p>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
