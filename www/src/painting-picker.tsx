import { useState } from "react";

import viewfinder from "../media/phone/viewfinder.json" with { type: "json" };
import { API } from "./api.ts";

const thumbnails = import.meta.glob<string>("../media/phone/thumbs/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
});
// The phone reads the same manifest, so a painting's index here names the same walk in the app.
const PAINTINGS = viewfinder.paintings.map(({ title, artist, thumbnail }) => ({
  title,
  artist,
  thumbnail: thumbnails[`../media/phone/${thumbnail}`],
}));

type Walk = { kind: "idle" } | { kind: "sending"; painting: number } | { kind: "error"; message: string };

/** Stands in for walking up to a painting: the phone's Scan viewfinder plays its walk and scans it. */
export function PaintingPicker({ sessionId }: { sessionId: string }) {
  const [walk, setWalk] = useState<Walk>({ kind: "idle" });

  async function pick(painting: number) {
    setWalk({ kind: "sending", painting });
    try {
      const res = await fetch(`${API}/sessions/${sessionId}/walk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ painting }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Your iPhone could not be reached. Try again.");
      }
      setWalk({ kind: "idle" });
    } catch (error) {
      setWalk({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="picker" role="group" aria-labelledby="picker-label">
      <p id="picker-label" className="picker-label">
        Walk up to a painting
      </p>
      <div className="paintings">
        {PAINTINGS.map(({ title, artist, thumbnail }, index) => (
          <button
            key={title}
            type="button"
            className="painting"
            title={`${title}, ${artist}`}
            aria-label={`${title}, ${artist}`}
            aria-busy={walk.kind === "sending" && walk.painting === index}
            disabled={walk.kind === "sending"}
            onClick={() => void pick(index)}
          >
            <img src={thumbnail} alt="" width={48} height={48} />
          </button>
        ))}
      </div>
      {walk.kind === "error" && (
        <p className="picker-error" role="alert">
          {walk.message}
        </p>
      )}
    </div>
  );
}
