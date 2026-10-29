import { defaultRemoteControlAssets, RemoteControl } from "@limrun/ui";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState, type ComponentProps, type FormEvent } from "react";

import appIcon from "../media/app-icon.png";
import { MAX_UPLOAD_BYTES } from "../server/upload-limit.ts";
import { API } from "./api.ts";
import { PaintingPicker } from "./painting-picker.tsx";
import { usePhoneNarration } from "./phone-narration.ts";

const APP_STORE_URL = "https://apps.apple.com/app/id6815466893";
const REPO_URL = "https://github.com/dwjiang/artlog-app";
const MET_OPEN_ACCESS_URL = "https://www.metmuseum.org/art/collection";
// The app keeps library photos at this long side, so a smaller upload loses no detail it uses.
const UPLOAD_LONG_SIDE = 2560;

function ExternalLink(props: ComponentProps<"a">) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
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
      <header className="brand">
        <img className="app-icon" src={appIcon} alt="" width={36} height={36} />
        Artlog
      </header>
      <section className="guide">
        <h1>Point at a painting. Learn its story.</h1>
        <p className="lede">
          Artlog names the painting in front of you, tells its story with sources, and reads it aloud. Try it here on a
          cloud iPhone that uses the App Store app&rsquo;s live backend. The tour takes about 4 minutes.
        </p>
        <ExternalLink className="listing" href={APP_STORE_URL} aria-label="Get Artlog on the App Store">
          <img className="app-icon" src={appIcon} alt="" width={60} height={60} />
          <span className="listing-text">
            <span className="listing-name">Artlog: Museum Art Scanner</span>
            <span className="listing-meta">Free on the App Store · iPhone</span>
          </span>
          <span className="get">Get</span>
        </ExternalLink>
        <ol className="steps">
          <li>
            <p>
              <b>Scan a painting.</b> The cloud iPhone has no camera, so a video walks up to the painting you pick.
              Artlog names it the same way it does through a real iPhone&rsquo;s camera.{" "}
              <span className="quiet">
                NVIDIA C-RADIOv3-B runs on the iPhone and matches it against about 400,000 artworks. The scan sends no
                pixels.
              </span>
            </p>
            <PaintingPicker sessionId={liveId} />
          </li>
          <li>
            <p>
              <b>Read its story.</b> Every sentence in About this work links to the page it came from.{" "}
              <span className="quiet">
                Tavily finds sources, Nemotron 3 Super pulls out quoted facts, and Nemotron 3.5 Lightning writes only
                from those.
              </span>
            </p>
          </li>
          <li>
            <p>
              <b>Listen.</b> Turn your sound on and tap Play audio guide. The audio plays from this page.{" "}
              <span className="quiet">
                Nemotron 3 Ultra writes the guide, the backend checks each sentence&rsquo;s evidence word for word, and
                an OpenAI voice reads it.
              </span>
            </p>
          </li>
          <li>
            <p>
              <b>Try your own photo.</b> Upload one, then tap Photos on the iPhone. No photo handy? Try{" "}
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
              <span className="caption">Uploads go only to your demo iPhone.</span>
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
          <li>
            <p>
              <b>See what&rsquo;s on.</b> Open Explore for current exhibitions around New York, each linked to the page
              it came from.{" "}
              <span className="quiet">
                Tavily reads museum pages that only load in a browser. Nemotron 3 Super lists each show, and Artlog
                keeps one only if its quoted title and dates are on the page.
              </span>
            </p>
          </li>
        </ol>
        <p className="closing">
          <b>Also in the app.</b>{" "}
          <span className="quiet">
            For a painting Artlog doesn&rsquo;t know, Nemotron 3 Super sorts the wall label&rsquo;s text into fields and
            Tavily checks them on the museum&rsquo;s website. Nemotron 3.5 Lightning screens what people add. Every
            Nemotron model runs on Nebius Token Factory.
          </span>
        </p>
        <footer className="links">
          <ExternalLink href={REPO_URL}>Source on GitHub</ExternalLink>
          <ExternalLink href={`${REPO_URL}#how-it-works`}>Technical write-up</ExternalLink>
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
                    ? "Starting the cloud iPhone. This takes about 20 seconds."
                    : phase.kind === "ended"
                      ? "Session ended."
                      : phase.kind === "error"
                        ? phase.message
                        : "Try the Artlog demo on a cloud iPhone."}
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
                <p className="or">or</p>
                <div className="screen-qr">
                  <QRCodeSVG value={APP_STORE_URL} size={76} marginSize={2} title="Artlog on the App Store" />
                  <p>Scan to get Artlog on your own iPhone.</p>
                </div>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
