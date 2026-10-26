// Side-panel block: each video's planned publication (the studio publishes it at that time unless the owner
// says "stop ap-N"). The Stop button is the office's only write: POST /api/stop, accepted by the
// server only with the access key; the server runs core/approve.mjs stop. Shown only when the server says can_stop.

import { useState } from "react";
import { relTime } from "../live/format";
import type { StudioState, VideoRow } from "../live/types";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "scheduled",
  stopped: "stopped",
  published: "published",
  "partly published": "partly published",
};

function localTime(iso: string, tz: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StopButton({ video }: { video: VideoRow }) {
  const ref = video.publish?.video_ref;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!ref) return null;
  const stop = async () => {
    if (!window.confirm(`Stop the publication of ${video.topic || video.id} (${ref})?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ref, note: "stop from the office" }),
      });
      const text = await res.text();
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // Plain-text error from the server.
      }
      setMsg(res.ok ? "Stopped." : `Not stopped: ${message}`);
    } catch (e) {
      setMsg(`Not stopped: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="sp-stop" disabled={busy} onClick={stop}>
        {busy ? "Stopping…" : `Stop ${ref}`}
      </button>
      {msg ? <span className="sp-meta" role="status">{msg}</span> : null}
    </>
  );
}

export function Publishing({ state, now }: { state: StudioState | null; now: number }) {
  const tz = state?.schedule?.timezone ?? globalThis.STUDIO_TZ;
  const rows = (state?.videos ?? []).filter((v) => v.publish && (v.publish.status || v.publish.scheduled_at));
  if (!rows.length) return <p className="sp-empty">Nothing planned for publication.</p>;
  return (
    <ul className="sp-list">
      {rows.map((v) => {
        const p = v.publish!;
        return (
          <li key={v.id} className={`sp-publish is-${(p.status ?? "draft").replace(/\s+/g, "-")}`}>
            <span className="sp-topic">{v.topic || v.id}</span>
            <span className="sp-meta">
              {p.scheduled_at ? `${localTime(p.scheduled_at, tz)} (${relTime(p.scheduled_at, now)})` : "no time"} · {STATUS_LABEL[p.status ?? ""] ?? "draft"}
              {p.video_ref ? ` · ${p.video_ref}` : ""}
            </span>
            {state?.can_stop && p.status === "scheduled" ? <StopButton video={v} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
