// The side panel next to the room: what waits for the owner's yes (and what is held until morning), the videos in
// production with their shot-by-shot render, the team, the stats per platform, the PC schedule with today's runs, the
// last problems and the last things the team did, in plain English. It only reads, with one exception:
// the Stop button of a scheduled video (POST /api/stop, shown only to a browser with the access key).
// Every section folds. Live-only sections (schedule, problems) are hidden in demo mode, which never shows real data.

import { useEffect, useState } from "react";
import { useLive } from "../live/source";
import { clockIn, compact, describeEvent, PLATFORM_LABEL, relTime, signed } from "../live/format";
import { EMPTY_METRICS, PLATFORMS, type StudioState, type VideoRow } from "../live/types";
import { ProblemList, RenderCard, ScheduleBlock, Steps, TeamList } from "./LiveBlocks";
import { Publishing } from "./Publishing";
import { ClaudeCharts } from "./ClaudeCharts";
import { StatsCharts } from "./StatsCharts";
import { Headline } from "./Headline";
import { VideoBoard } from "./VideoBoard";
import { Section } from "./Section";

const RECENT = 15;

function nextVideo(state: StudioState | null): VideoRow | null {
  const open = (state?.videos ?? []).filter((v) => v.status !== "published" && v.status !== "rejected");
  if (!open.length) return null;
  return [...open].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] ?? null;
}

/** Re-renders every 30 s so "3 min ago" stays true. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Approvals({ state, now }: { state: StudioState | null; now: number }) {
  const approvals = state?.approvals ?? [];
  const queued = state?.approvals_queue ?? [];
  const tz = state?.schedule?.timezone ?? globalThis.STUDIO_TZ;
  if (!approvals.length && !queued.length) return <p className="sp-empty">Nothing waiting for you.</p>;
  return (
    <ul className="sp-list">
      {approvals.map((a) => (
        <li key={a.ref} className="sp-approval">
          <span className="sp-ref">{a.ref}</span>
          <span className="sp-kind">{a.kind}</span>
          <span className="sp-topic">{a.topic || a.video_id || "—"}</span>
        </li>
      ))}
      {queued.map((q, i) => (
        <li key={`q-${i}-${q.video_id ?? ""}-${q.kind}`} className="sp-approval is-queued" title={q.text ?? undefined}>
          <span className="sp-ref">{q.release_at ? `arrives ${clockIn(q.release_at, tz, now)}` : "queued"}</span>
          <span className="sp-kind">{q.kind}</span>
          <span className="sp-topic">{q.text || q.video_id || "—"}</span>
        </li>
      ))}
    </ul>
  );
}

function Production({ state, now }: { state: StudioState | null; now: number }) {
  const renders = state?.renders ?? [];
  if (renders.length) return <>{renders.map((r) => <RenderCard key={r.video_id} r={r} now={now} />)}</>;
  const video = nextVideo(state);
  if (!video) return <p className="sp-empty">No video in progress.</p>;
  return (
    <div className="sp-video">
      <p className="sp-video-topic">{video.topic || video.id}</p>
      <p className="sp-meta">
        {video.lane ? `${video.lane} · ` : ""}updated {relTime(video.updated_at, now)}
      </p>
      <Steps status={video.status} />
    </div>
  );
}

/** Pause / Reprendre: writes data/production-paused.json through POST /api/pause (core/job.mjs). */
/** Three lights: green ok, red down. */
function Lights({ h }: { h: StudioState["health"] }) {
  if (!h) return null;
  const one = (ok: boolean, label: string) => (
    <span className="sp-light" title={label}>
      <i style={{ background: ok ? "#22c55e" : "#ef4444" }} />
      {label}
    </span>
  );
  return <div className="sp-lights">{one(h.tasks, "Tâches")}{one(h.comfy, "Images")}{one(h.server, "Vitrine")}</div>;
}

function PauseButton({ paused }: { paused: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: !paused }) });
      if (!r.ok) setError(r.status === 401 ? "Clé d’accès nécessaire" : `Erreur ${r.status}`);
    } catch {
      setError("Serveur injoignable");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sp-pause-row">
      <button type="button" className={`sp-pause-btn ${paused ? "is-paused" : ""}`} onClick={toggle} disabled={busy}>
        {busy ? "…" : paused ? "▶ Marche" : "⏸ Pause"}
      </button>
      {error ? <span className="sp-meta">{error}</span> : null}
    </div>
  );
}

const NET_LABEL: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };

function QueueList({ state, now }: { state: StudioState | null; now: number }) {
  const q = state?.queue;
  const tz = state?.schedule?.timezone ?? globalThis.STUDIO_TZ;
  if (!q || (!q.in_production.length && !q.ready.length && !q.published.length)) return <p className="sp-empty">Aucune vidéo pour le moment.</p>;
  const group = (title: string, items: typeof q.ready, withLinks = false) =>
    items.length ? (
      <div className="sp-queue-group">
        <p className="sp-queue-title">{title} ({items.length})</p>
        <ul className="sp-list">
          {items.map((v) => (
            <li key={v.id} className="sp-queue-item">
              <span className="sp-topic">{v.title}</span>
              {withLinks && v.links ? (
                <span className="sp-links">
                  {Object.entries(v.links).map(([net, url]) => (
                    <a key={net} href={url} target="_blank" rel="noreferrer noopener">{NET_LABEL[net] ?? net}</a>
                  ))}
                  {v.published_at ? <time> · {clockIn(v.published_at, tz, now)}</time> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <>
      {group("En fabrication", q.in_production)}
      {group("Prêtes", q.ready)}
      {group("Publiées", q.published, true)}
    </>
  );
}

function ConceptPanel({ state }: { state: StudioState | null }) {
  const c = state?.concept;
  if (!c || (!c.heroes.length && !c.voices.length)) return <p className="sp-empty">Les propositions arrivent ici.</p>;
  return (
    <>
      {c.heroes.map((h) => (
        <div key={h.id} className="sp-hero">
          <p className="sp-queue-title">{h.name}</p>
          {h.line ? <p className="sp-meta">{h.line}</p> : null}
          <div className="sp-hero-images">
            {h.images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noreferrer noopener"><img src={src} alt={h.name} loading="lazy" /></a>
            ))}
          </div>
        </div>
      ))}
      {c.voices.length ? (
        <div className="sp-voices">
          <p className="sp-queue-title">Voix</p>
          {c.voices.map((v) => (
            <div key={v.url} className="sp-voice">
              <span className="sp-meta">{v.name}</span>
              <audio controls preload="none" src={v.url} />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** "Consommation Claude": the studio's agent runs of the day against the cap, tokens and the last runs (data/runs.jsonl). */
function ClaudeUsage({ state, now }: { state: StudioState | null; now: number }) {
  const r = state?.runs_today;
  const tz = state?.schedule?.timezone ?? globalThis.STUDIO_TZ;
  if (!r) return <p className="sp-empty">Pas encore de lancement aujourd'hui.</p>;
  const max = r.max ?? 40;
  const pct = Math.min(100, Math.round((r.used / max) * 100));
  const left = r.reset_at ? Math.max(0, Date.parse(r.reset_at) - now) : null;
  const countdown = left !== null ? `${Math.floor(left / 3_600_000)} h ${String(Math.floor((left % 3_600_000) / 60_000)).padStart(2, "0")}` : null;
  const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n));
  return (
    <>
      <p className="sp-queue-title">Lancements d'agents aujourd'hui : {r.used} / {max}</p>
      <div className="sp-usage-bar"><i style={{ width: `${pct}%` }} className={pct >= 90 ? "is-high" : ""} /></div>
      <p className="sp-meta">
        {countdown ? `Le compteur repart dans ${countdown} (à ${clockIn(r.reset_at, tz, now)}).` : ""}
        {r.rate_limited ? ` Limite Claude atteinte ${r.rate_limited} fois.` : ""}
        {r.failed ? ` ${r.failed} lancement(s) en échec.` : ""}
      </p>
      {r.tokens && r.measured ? (
        <>
          <p className="sp-meta">
            Jetons ({r.measured} lancement(s) mesurés) : {k(r.tokens.input)} lus, {k(r.tokens.output)} écrits, {k(r.tokens.cache)} en cache
            {r.api_equiv_usd ? ` · équivalent API ${r.api_equiv_usd.toFixed(2)} $ (non facturé : abonnement)` : ""}
          </p>
          <p className="sp-meta">Par modèle : {(r.by_model ?? []).map((m) => `${m.name} ${m.runs} (${k(m.tokens)})`).join(" · ")}</p>
        </>
      ) : (
        <p className="sp-meta">Les jetons sont mesurés à partir du prochain lancement.</p>
      )}
      <p className="sp-meta">Par agent : {(r.by_agent ?? []).map((a) => `${a.name} ${a.runs}`).join(" · ")}</p>
      {r.recent?.length ? (
        <ul className="sp-list">
          {r.recent.map((x, i) => (
            <li key={`${x.at}-${i}`} className="sp-queue-item">
              <span className="sp-meta">
                {clockIn(x.at, tz, now)} · {x.agent} ({x.model}){x.tokens ? ` · ${k(x.tokens)} jetons` : ""}{x.seconds ? ` · ${x.seconds} s` : ""}{x.ok ? "" : " · échec"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Stats({ state, demo }: { state: StudioState | null; demo: boolean }) {
  const metrics = state?.metrics ?? EMPTY_METRICS;
  const none = PLATFORMS.every((p) => metrics[p]?.views == null && metrics[p]?.followers_delta == null);
  return (
    <>
      <table className="sp-stats">
        <thead>
          <tr>
            <th />
            <th>Views</th>
            <th>Followers</th>
          </tr>
        </thead>
        <tbody>
          {PLATFORMS.map((p) => (
            <tr key={p}>
              <th>{PLATFORM_LABEL[p]}</th>
              <td className="wr-num">{compact(metrics[p]?.views)}</td>
              <td className="wr-num">{signed(metrics[p]?.followers_delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {demo ? <p className="sp-meta">Placeholder numbers (demo).</p> : none ? <p className="sp-meta">No stats snapshot yet.</p> : <p className="sp-meta">Latest snapshot of each video, summed.</p>}
    </>
  );
}

export function SidePanel() {
  const { state, events, demo } = useLive();
  const now = useMinuteClock();
  const recent = [...(state?.recent ?? []), ...events];
  const seen = new Set<number>();
  const last = recent
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => b.id - a.id)
    .slice(0, RECENT);
  const agents = state?.agents ?? [];
  const pendingCount = (state?.approvals?.length ?? 0) + (state?.approvals_queue?.length ?? 0);
  const busy = agents.filter((a) => a.state !== "idle").length;
  const working = agents.filter((a) => a.state === "working" && a.id !== "chief_of_staff");
  const errors = state?.errors ?? [];
  const problemCount = errors.length + agents.filter((a) => a.state === "error").length;
  const paused = !demo ? state?.paused : null;
  const tz = state?.schedule?.timezone ?? globalThis.STUDIO_TZ;

  return (
    <aside className="sp" aria-label="Studio status">
      {state && state.db === false && !demo ? <p className="sp-note">No database yet (data/studio.db). The office will fill in as soon as the team starts.</p> : null}
      {paused ? (
        <p className="sp-note sp-pause" role="status">
          <b>Studio paused until {clockIn(paused.until, tz, now)}</b>
          {paused.reason ? ` · ${paused.reason}` : ""}
        </p>
      ) : null}

      {/* The numbers that matter first, then the controls. */}
      {!demo ? <Headline state={state} now={now} /> : null}
      {!demo ? <PauseButton paused={Boolean(state?.production_paused)} /> : null}
      {!demo ? <Lights h={state?.health} /> : null}

      {!demo && state?.production_paused ? (
        <p className="sp-note sp-pause" role="status"><b>Production en pause</b>{state.production_paused.since ? ` depuis ${clockIn(state.production_paused.since, tz, now)}` : ""}</p>
      ) : null}

      {/* No "to approve" box: the studio publishes on its own, no approvals. */}

      {/* One visual board instead of text lists. Statistiques first: real views, followers, top 5, decisions; results come
          before production. */}
      {!demo ? (
        <Section id="stats" title="Statistiques">
          <StatsCharts state={state} now={now} />
        </Section>
      ) : null}

      {!demo ? (
        <Section id="queue" title="Vidéos" count={state?.queue?.published.length}>
          <VideoBoard state={state} now={now} />
          {!state?.queue?.in_production.length && working.length ? (
            <p className="sp-meta">{working.map((a) => `${a.label} : ${a.task || "au travail"}`).join(" · ")}</p>
          ) : null}
        </Section>
      ) : null}

      {!demo ? (
        <Section id="claude" title="Consommation Claude">
          <ClaudeCharts state={state} now={now} />
        </Section>
      ) : null}

      {/* Only what is automated is shown: no narrator or promo voice samples (the narrator voice is the concept's,
          concept/<id>/concept.json). */}

      {/* Kept lean: no Team list (the room shows it), no empty Stats table or PC schedule (24/7); Problems shows only when there is one. */}
      {!demo && problemCount ? (
        <Section id="problems" title="Problèmes" badge={<span className="sp-count is-soft">{problemCount}</span>}>
          <ProblemList errors={errors} agents={agents} now={now} />
        </Section>
      ) : null}

      <Section id="recent" title="Activité">
        {last.length ? (
          <ol className="sp-list sp-recent">
            {last.map((e) => (
              <li key={e.id}>
                <span className={`sp-dot k-${e.kind}`} />
                <time>{clockIn(e.at, tz, now)}</time>
                <span className="sp-text">{describeEvent(e)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="sp-empty">No work yet.</p>
        )}
      </Section>
    </aside>
  );
}
