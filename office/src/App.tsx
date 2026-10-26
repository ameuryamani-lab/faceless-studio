// The office page: the live worker room on the left, the side panel on the right (below it on narrow screens).
// Full screen covers both, so a screen recording at 1920×1080 shows the whole office.

import { useEffect, useMemo, useRef, useState } from "react";
import { makeCover } from "./live/covers";
import { DEMO_FEED } from "./live/demo";
import { LiveProvider, useLive } from "./live/source";
import { SidePanel } from "./panel/SidePanel";
import type { StudioState } from "./live/types";
import type { FeedCard, WallFeedData } from "./room/types";
import { useFullscreen } from "./room/use-fullscreen";
import { WorkerRoom } from "./room/WorkerRoom";

const PANEL_KEY = "office.panel";

function readPanelPref(): boolean {
  try {
    return window.localStorage.getItem(PANEL_KEY) !== "closed";
  } catch {
    return true;
  }
}

function savePanelPref(open: boolean) {
  try {
    window.localStorage.setItem(PANEL_KEY, open ? "open" : "closed");
  } catch {
    // Private windows can refuse storage; the panel still works, it just forgets.
  }
}

/** YouTube id of a Shorts or watch URL, or null. */
function ytId(url: string): string | null {
  return /(?:shorts\/|v=|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url)?.[1] ?? null;
}

/** Right wall in live mode: the latest trend scan's top Shorts, with their real thumbnails (cached by the server). */
function trendCards(state: StudioState | null): FeedCard[] {
  return (state?.trends ?? []).map((t, i) => {
    const id = ytId(t.video_url);
    return {
      id: t.video_url,
      title: t.title || "Untitled Short",
      cover: id ? `/thumb/${id}.jpg` : makeCover(i + 3, true),
      views: t.views ?? null,
      platform: "youtube",
      ratio: t.ratio,
      detail: `${t.channel ?? "Unknown channel"} · ${t.ratio !== null ? `${t.ratio}× its median` : "no median yet"}${t.usable === 0 ? ` · à éviter : ${t.flag_reason ?? "signalée"}` : ""}`,
      notUsable: t.usable === 0,
      badge: t.used ? "✓ UTILISÉE" : undefined,
      age: ageOf(t.upload_date),
      href: /^https:\/\//.test(t.video_url) ? t.video_url : null,
    };
  });
}

/** "3 j" from a YYYYMMDD upload date, or undefined. */
function ageOf(d: string | null | undefined): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(d ?? ""));
  if (!m) return undefined;
  const days = Math.max(0, Math.round((Date.now() - Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) / 86_400_000));
  return days === 0 ? "auj." : `${days} j`;
}

const BADGE: Record<string, string> = { published: "EN LIGNE", qc_passed: "PRÊTE", approved: "PRÊTE", awaiting_approval: "PRÊTE" };
const cleanTitle = (s: string) => s.replace(/^\s*\[[^\]]*\]\s*/, "");

/** Left wall "Our channel": our latest videos, published first. Right wall "Trending": the latest scan, else blank phones. */
function useFeed(rec = false): WallFeedData {
  const { state, demo } = useLive();
  return useMemo(() => {
    const videos = state?.videos ?? [];
    const published = new Set((state?.posts ?? []).filter((p) => p.published_at).map((p) => p.video_id));
    const ours: FeedCard[] = [...videos]
      .sort((a, b) => Number(published.has(b.id) || b.status === "published") - Number(published.has(a.id) || a.status === "published"))
      .map((v, i) => ({
        id: v.id,
        title: cleanTitle(v.topic || v.id),
        cover: v.cover ?? (demo ? makeCover(i + 20) : null),
        views: v.views ?? null,
        platform: "all",
        badge: demo ? undefined : published.has(v.id) ? "EN LIGNE" : BADGE[v.status] ?? "EN FABRICATION",
        href: demo ? null : v.link ?? null,
      }));
    if (!demo) {
      // 2026-10-23: the wall shows the same real total as the Statistiques block (all 3 networks, Upload-Post counts).
      const t = state?.stats?.totals;
      const totalViews = t ? t.instagram.views + t.tiktok.views + t.youtube.views : ours.reduce((n, c) => n + (c.views ?? 0), 0);
      const count = state?.trends_count ?? null;
      const usable = count && count.usable !== null && count.usable !== undefined ? Number(count.usable) : null;
      // In the film (?rec=1) other creators' thumbnails are replaced by generic covers.
      const trending = rec ? trendCards(state).map((c, i) => ({ ...c, cover: makeCover(i + 3, true), title: "Trending Short" })) : trendCards(state);
      return { cards: ours, trending, totalViews, totalPosts: published.size, trendUsable: usable, trendTotal: count ? Number(count.total) : null };
    }
    const shown = ours.filter((c) => videos.find((v) => v.id === c.id)?.status === "published");
    const cards: FeedCard[] = [...shown, ...DEMO_FEED.cards.map((c) => ({ ...c, platform: "all" }))];
    const trending: FeedCard[] = DEMO_FEED.trending.map((c) => ({ ...c, platform: "all" }));
    return { cards, trending, totalViews: cards.reduce((n, c) => n + (c.views ?? 0), 0), totalPosts: cards.length };
  }, [state?.videos, state?.posts, state?.trends, state?.trends_count, state?.stats, demo, rec]);
}

/** Recording mode (?rec=1, the "coulisses" film): the job running now and the studio clock, in a corner. */
function RecOverlay() {
  const { state } = useLive();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const clock = new Intl.DateTimeFormat("fr-FR", { timeZone: globalThis.STUDIO_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now);
  const working = (state?.agents ?? []).filter((a) => a.state === "working" && a.id !== "chief_of_staff");
  const job = state?.production ? `${state.production.text}` : working[0] ? `${working[0].label} : ${working[0].task ?? "au travail"}` : "Le studio attend la prochaine étape";
  return (
    <div className="rec-overlay" aria-hidden="true">
      <b>{clock}</b>
      <span>{job}</span>
    </div>
  );
}

function Office({ hold, rec }: { hold: boolean; rec: boolean }) {
  const shell = useRef<HTMLDivElement>(null);
  const full = useFullscreen(shell);
  const feed = useFeed(rec);
  // The old 2D room stays for the films (?rec=1, ?clean=1, ?demo=1) and as a way back (?ancienne=1).
  const q = new URLSearchParams(window.location.search);
  const salle3d = !rec && !["ancienne", "clean", "demo"].some((k) => q.get(k) === "1");
  const [open, setOpen] = useState(() => !rec && readPanelPref());
  const toggle = () =>
    setOpen((o) => {
      savePanelPref(!o);
      return !o;
    });

  const panelButton = (
    <button type="button" className={`wr-hold sp-toggle${open ? " is-on" : ""}`} aria-expanded={open} aria-controls="office-panel" onClick={toggle}>
      {open ? "Masquer" : "Panneau"}
    </button>
  );

  return (
    // ?clean=1 (the promo film, 2026-10-22): no tour bar, clock or header, almost no text on screen.
    <div ref={shell} className={`office${open ? " has-panel" : ""}${new URLSearchParams(window.location.search).get("clean") === "1" ? " is-clean" : ""}`}>
      <div className="office-room">
        {salle3d ? (
          // The 3D room, fed with live data by its own bridge (office/salle/bridge.js).
          <>
            <iframe className="office-salle" src="/salle.html" title="Salle du studio en 3D" />
            <button type="button" className={`office-salle-toggle${open ? " is-on" : ""}`} aria-expanded={open} aria-controls="office-panel" onClick={toggle}>
              {open ? "Masquer" : "Panneau"}
            </button>
          </>
        ) : (
          <WorkerRoom feed={feed} full={full} hold={hold} extra={rec ? null : panelButton} />
        )}
        {rec ? <RecOverlay /> : null}
      </div>
      {open ? (
        <div className="office-panel" id="office-panel">
          <SidePanel />
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const demo = params.get("demo") === "1";
  const speed = Math.min(4, Math.max(0.25, Number(params.get("speed")) || 1));
  const rec = params.get("rec") === "1";
  const hold = params.get("tour") !== "1";
  return (
    <LiveProvider demo={demo} speed={speed}>
      <Office hold={hold} rec={rec} />
    </LiveProvider>
  );
}
