import { RemoteControl } from "@limrun/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";

const APP_STORE_URL = "https://apps.apple.com/app/id6815466893";

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
  void fetch(`/api/sessions/${id}/stop`, { method: "POST", keepalive: true }).catch(() => undefined);
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

  useEffect(() => {
    void fetch("/api/config")
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
    setPhase({ kind: "starting" });
    setUpload({ kind: "idle" });
    try {
      const res = await fetch("/api/sessions", {
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
      const res = await fetch(`/api/sessions/${liveId}/photos`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
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
      <section className="intro">
        <p className="wordmark">Artlog</p>
        <h1>Point at a painting. Learn its story.</h1>
        <p className="lede">
          This is the Artlog iPhone app, running on a cloud iPhone you control from your browser. It uses the same live
          backend as the App Store app.
        </p>
        <ol className="steps">
          <li>
            <strong>Scan.</strong> Open the <em>Scan</em> tab and tap a painting in the row above the shutter. The phone
            walks up to it, and the app outlines and scans it on its own.
          </li>
          <li>
            <strong>Or scan a photo.</strong> Tap <em>Photos</em> for a gallery photo, or add your own with{" "}
            <em>Upload a photo</em> under the phone.
          </li>
          <li>
            <strong>Read and listen.</strong> Read the story and its sources, tap <em>Play audio guide</em>, then{" "}
            <em>Transcript</em>.
          </li>
        </ol>
        <p className="note">
          The cloud iPhone has no camera and no sound, so the viewfinder plays a video of a gallery wall and the audio
          guide shows its transcript. Photos you upload go only to your demo iPhone; scanning one sends it to
          Artlog&rsquo;s servers for matching, as the App Store app does. A session ends after 10 minutes without use,
          or after 30 minutes, and its iPhone is deleted.
        </p>
        <p className="note">
          On an iPhone? <a href={APP_STORE_URL}>Get Artlog on the App Store</a>.
        </p>
      </section>

      <section className="device" aria-label="Cloud iPhone">
        {phase.kind === "live" ? (
          <div className="stream">
            <RemoteControl
              url={phase.session.endpointWebSocketUrl}
              token={phase.session.streamToken}
              sessionId={viewerId}
              autoReconnect
              onTerminated={() => setPhase({ kind: "ended" })}
            />
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={upload.kind === "sending"}
                onClick={() => fileInput.current?.click()}
              >
                {upload.kind === "sending" ? "Sending…" : "Upload a photo"}
              </button>
              <button type="button" className="secondary" onClick={end}>
                End session
              </button>
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
          </div>
        ) : (
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
          </form>
        )}
      </section>
    </main>
  );
}
