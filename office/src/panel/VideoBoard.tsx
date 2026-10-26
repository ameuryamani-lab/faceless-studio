// The video board (see at a glance rather than read: green published, yellow not yet):
// three coloured counters, the 8-step stepper of the video being made, then one tile per video (its cover in a coloured frame,
// a big dot, the 3 platform logos). Almost no words.

import { useState } from "react";
import { clockIn } from "../live/format";
import type { QueueItem, StudioState } from "../live/types";

const GREEN = "#22c55e";
const YELLOW = "#facc15";
const GREY = "#8b8fa3";
const RED = "#ef4444";
const STEP_ICONS = ["📈", "✍️", "🔎", "🖼️", "🎙️", "🎬", "✅", "🚀"];
const STEP_NAMES = ["Tendance", "Écriture", "Vérifications", "Images", "Voix", "Montage", "Contrôle", "Publication"];
const NETS: { key: "youtube" | "instagram" | "tiktok"; label: string; color: string }[] = [
  { key: "youtube", label: "YT", color: "#ff0033" },
  { key: "instagram", label: "IG", color: "#e1306c" },
  { key: "tiktok", label: "TT", color: "#25f4ee" },
];

/** "tomorrow 00:37" -> "demain 0 h 37". */
const frClock = (s: string) => s.replace("tomorrow", "demain").replace(/(\d{2}):(\d{2})/, (_m, h: string, mi: string) => `${Number(h)} h ${mi}`);

function Counters({ live, ready, making }: { live: number; ready: number; making: number }) {
  const one = (n: number, color: string, label: string) => (
    <div className="vb-count" title={label}>
      <i style={{ background: color }} />
      <b>{n}</b>
    </div>
  );
  return <div className="vb-counters">{one(live, GREEN, "en ligne")}{one(ready, YELLOW, "prêtes")}{one(making, GREY, "en fabrication")}</div>;
}

function Stepper({ v }: { v: QueueItem }) {
  const s = v.stepper;
  if (!s) return null;
  return (
    <div className="vb-stepper" aria-label={`${v.title} : étapes`}>
      {s.steps.map((st, i) => (
        <div key={i} className={`vb-step is-${st}`} title={STEP_NAMES[i]}>
          <span>{STEP_ICONS[i]}</span>
          {st === "now" && i === 3 ? <em style={{ width: `${Math.round((s.images.done / Math.max(1, s.images.total)) * 100)}%` }} /> : null}
        </div>
      ))}
    </div>
  );
}

function Logos({ v }: { v: QueueItem }) {
  return (
    <div className="vb-logos">
      {NETS.map((n) => {
        const st = v.nets?.[n.key] ?? null;
        const url = v.links?.[n.key];
        const style = { background: st === "ok" ? n.color : st === "fail" ? RED : "rgba(255,255,255,0.08)", color: st ? "#0b0712" : "#6b5a8c" };
        const count = st === "ok" && v.views ? <small>{v.views[n.key] ?? "–"}</small> : null;
        return st === "ok" && url ? (
          <a key={n.key} href={url} target="_blank" rel="noreferrer noopener" style={style}>{n.label}{count}</a>
        ) : (
          <span key={n.key} style={style}>{n.label}</span>
        );
      })}
    </div>
  );
}

const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n));

function Tile({ v, color, badge, benchmark }: { v: QueueItem; color: string; badge?: string; benchmark?: number | null }) {
  const fill = typeof v.progress === "number" && color === GREY ? Math.round(v.progress * 100) : null;
  return (
    <div className="vb-tile" style={{ borderColor: color }}>
      <div className="vb-cover" style={v.cover ? { backgroundImage: `url(${v.cover})` } : undefined}>
        <i className="vb-dot" style={{ background: color }} />
        {badge ? <span className="vb-clock">🕒 {badge}</span> : null}
        {color === GREEN && v.views ? <span className="vb-views">👁 {v.views.total ?? "–"}{benchmark ? ` / ${short(benchmark)}` : ""}</span> : null}
        {color === GREEN && benchmark ? (
          <div className="vb-bench" title="vues / objectif"><em style={{ width: `${Math.min(100, Math.max(1.5, ((v.views?.total ?? 0) / benchmark) * 100))}%` }} /></div>
        ) : null}
        {fill !== null ? <div className="vb-fill"><em style={{ width: `${fill}%` }} /></div> : null}
      </div>
      <p className="vb-title">{v.title}</p>
      <Logos v={v} />
    </div>
  );
}

/** A network's daily limit is handled on its own, so it shows
 *  here as a calm yellow line ("TikTok reprend vers 21 h 36 · 2 en attente"), never in the Problems box. */
function NetWaits({ state, tz, now }: { state: StudioState | null; tz: string; now: number }) {
  const nets = state?.net_status?.nets;
  if (!nets) return null;
  const lines = NETS.flatMap((n) => {
    const s = nets[n.key];
    if (!s || (!s.owed && !s.until)) return [];
    const wait = s.until && Date.parse(s.until) > now ? `reprend vers ${frClock(clockIn(s.until, tz, now))}` : "rattrape 1 par heure";
    return [{ n, text: `${wait}${s.owed ? ` · ${s.owed} en attente` : ""}` }];
  });
  if (!lines.length) return null;
  return (
    <div className="vb-waits">
      {lines.map(({ n, text }) => (
        <p key={n.key} className="vb-wait"><span style={{ background: YELLOW, color: "#0b0712" }}>{n.label}</span>{text}</p>
      ))}
    </div>
  );
}

/** Shown once 10 published videos have view counts (a scatter of 1-3 dots is confusing). */
export const BEST_HOURS_MIN_VIDEOS = 10;

/** "Meilleures heures de sortie": 6 blocks of 4 h (studio time), bar = average views of the videos released in it, best in green. */
export function BestHours({ points }: { points: { h: number; views: number | null; title?: string }[] }) {
  const blocks = Array.from({ length: 6 }, (_, b) => {
    const inBlock = points.filter((p) => p.views !== null && Math.floor(p.h / 4) === b);
    const avg = inBlock.length ? inBlock.reduce((n, p) => n + (p.views ?? 0), 0) / inBlock.length : null;
    return { b, avg, n: inBlock.length };
  });
  const max = Math.max(1, ...blocks.map((x) => x.avg ?? 0));
  const best = blocks.reduce((a, x) => ((x.avg ?? -1) > (a.avg ?? -1) ? x : a), blocks[0]!);
  const W = 300, H = 120, B = 18, T = 14, bw = W / 6;
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cc-chart" role="img" aria-label="meilleures heures de sortie">
      {blocks.map((x) => {
        const h = x.avg === null ? 0 : ((H - B - T) * x.avg) / max;
        return (
          <g key={x.b}>
            <rect x={x.b * bw + 6} y={H - B - h} width={bw - 12} height={Math.max(h, 2)} rx={4} fill={x === best && x.avg ? GREEN : "rgba(181,102,255,0.6)"} />
            {x.avg !== null ? <text x={x.b * bw + bw / 2} y={H - B - h - 3} textAnchor="middle" fontSize={9} fill="#f4eeff">{k(x.avg)}</text> : null}
            <text x={x.b * bw + bw / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="#b9a9d6">{`${x.b * 4}-${x.b * 4 + 4} h`}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Published tiles shown before "voir tout" (22 tall covers was too long). */
const PUBLISHED_SHOWN = 6;

export function VideoBoard({ state, now }: { state: StudioState | null; now: number }) {
  const [all, setAll] = useState(false);
  const q = state?.queue;
  const tz = state?.schedule?.timezone ?? globalThis.STUDIO_TZ;
  if (!q) return null;
  const ready = [...q.ready].sort((a, b) => Date.parse(a.publish_at ?? "9999") - Date.parse(b.publish_at ?? "9999"));
  const published = [...q.published].sort((a, b) => Date.parse(b.published_at ?? "0") - Date.parse(a.published_at ?? "0"));
  const shown = all ? published : published.slice(0, PUBLISHED_SHOWN);
  return (
    <div className="vb">
      <Counters live={q.published.length} ready={q.ready.length} making={q.in_production.length} />
      <NetWaits state={state} tz={tz} now={now} />
      {q.in_production.map((v) => <Stepper key={`s-${v.id}`} v={v} />)}
      <div className="vb-grid">
        {q.in_production.map((v) => <Tile key={v.id} v={v} color={GREY} />)}
        {ready.map((v) => <Tile key={v.id} v={v} color={YELLOW} badge={v.publish_at ? frClock(clockIn(v.publish_at, tz, now)) : undefined} />)}
        {shown.map((v) => <Tile key={v.id} v={v} color={GREEN} benchmark={state?.benchmark} />)}
        {/* Only what is automated: one-off films (promo, coulisses) are not shown here; their files stay in media/promo and
            media/coulisses. A test waiting for the owner's decision shows as ONE tile and goes once decided. */}
        {state?.trial ? (
          <div className="vb-tile vb-film" style={{ borderColor: YELLOW }}>
            <a href={state.trial.url} target="_blank" rel="noreferrer noopener" className="vb-cover" style={{ backgroundImage: `url(${state.trial.cover})` }}>
              <span className="vb-play">▶</span>
            </a>
            <p className="vb-title">{state.trial.title}</p>
          </div>
        ) : null}
      </div>
      {published.length > PUBLISHED_SHOWN ? (
        <button type="button" className="vb-more" onClick={() => setAll((a) => !a)}>
          {all ? "Réduire" : `Voir les ${published.length - PUBLISHED_SHOWN} autres vidéos en ligne`}
        </button>
      ) : null}
      {new Set((state?.views_by_hour ?? []).filter((p) => p.views !== null).map((p) => p.title)).size >= BEST_HOURS_MIN_VIDEOS ? (
        <>
          <p className="cc-legend">Meilleures heures de sortie</p>
          <BestHours points={state!.views_by_hour!} />
        </>
      ) : null}
    </div>
  );
}
