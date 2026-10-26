// "Statistiques" as graphs: views per network over
// the week, totals and followers with the change since yesterday, the top 5 videos with their cover, and the decisions the
// analysis applied on its own. Fed live by office/stats.mjs from the hourly counts (Upload-Post).

import type { StudioState } from "../live/types";

const NETS = [
  { id: "instagram", label: "Instagram", color: "#ff6fae" },
  { id: "tiktok", label: "TikTok", color: "#7dd3fc" },
  { id: "youtube", label: "YouTube", color: "#ffb547" },
] as const;
const DIM = "#6b5a8c";

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} M` : n >= 10_000 ? `${Math.round(n / 1000)} k` : n.toLocaleString("fr-FR"));
const signed = (n: number | null) => (n === null ? "" : n > 0 ? `+${k(n)}` : n < 0 ? `−${k(-n)}` : "=");
const day = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: globalThis.STUDIO_TZ, day: "2-digit", month: "2-digit" }).format(Date.parse(iso));

type Stats = NonNullable<StudioState["stats"]>;

function ViewsCurve({ series }: { series: Stats["series"] }) {
  const W = 300, H = 110, P = 8, B = 14;
  const max = Math.max(1, ...series.flatMap((s) => NETS.map((n) => s[n.id])));
  const px = (i: number) => P + (i / Math.max(1, series.length - 1)) * (W - 2 * P);
  const py = (v: number) => H - B - (v / max) * (H - B - P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cc-chart" role="img" aria-label="vues par réseau sur 7 jours">
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={P} x2={W - P} y1={py(max * f)} y2={py(max * f)} stroke="rgba(255,255,255,0.06)" />)}
      {NETS.map((n) => (
        <polyline key={n.id} points={series.map((s, i) => `${px(i).toFixed(1)},${py(s[n.id]).toFixed(1)}`).join(" ")} fill="none" stroke={n.color} strokeWidth={2.2} strokeLinejoin="round" />
      ))}
      {NETS.map((n) => series.map((s, i) => <circle key={`${n.id}${i}`} cx={px(i)} cy={py(s[n.id])} r={2} fill={n.color} />))}
      {series.map((s, i) => (i % 2 === series.length % 2 ? null : <text key={s.at} x={px(i)} y={H - 2} textAnchor="middle" fontSize={8} fill={DIM}>{day(s.at)}</text>))}
      <text x={W - P} y={P + 6} textAnchor="end" fontSize={8.5} fill={DIM}>{k(max)}</text>
    </svg>
  );
}

function NetTiles({ totals }: { totals: Stats["totals"] }) {
  return (
    <div className="st-tiles">
      {NETS.map((n) => {
        const t = totals[n.id];
        return (
          <div key={n.id} className="st-tile" style={{ borderColor: n.color }}>
            <span className="st-net" style={{ color: n.color }}>{n.label}</span>
            <b>{k(t.views)}</b>
            <span className="st-sub">vues {t.views_change ? <em className={t.views_change > 0 ? "up" : "down"}>{signed(t.views_change)}</em> : null}</span>
            <b className="st-small">{t.followers === null ? "—" : k(t.followers)}</b>
            <span className="st-sub">abonnés {t.followers_change ? <em className={t.followers_change > 0 ? "up" : "down"}>{signed(t.followers_change)}</em> : null}</span>
          </div>
        );
      })}
    </div>
  );
}

// 2026-10-24 (the concept is a parameter): the title loses the active concept's hook prefix (state.concept.active.hook_prefix,
// e.g. "Imagine") and its final "?", never a hard-coded hook; without a prefix the title stays whole.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function shortTitle(title: string, hookPrefix: string | null | undefined): string {
  const bare = hookPrefix ? title.replace(new RegExp(`^${escapeRe(hookPrefix)}\\s*`, "i"), "") : title;
  return bare.replace(/\?$/, "");
}

function TopVideos({ top, hookPrefix }: { top: Stats["top"]; hookPrefix: string | null | undefined }) {
  const max = Math.max(1, ...top.map((v) => v.views));
  return (
    <ol className="st-top">
      {top.map((v) => {
        const net = NETS.find((n) => n.id === v.platform);
        return (
          <li key={`${v.video_id}${v.platform}`}>
            {v.cover ? <img src={v.cover} alt="" loading="lazy" /> : <span className="st-nocover" />}
            <div>
              <p className="st-title">{shortTitle(v.title, hookPrefix)}</p>
              <span className="st-bar"><i style={{ width: `${(100 * v.views) / max}%`, background: net?.color }} /></span>
              <span className="st-sub"><b>{k(v.views)}</b> vues · <span style={{ color: net?.color }}>{net?.label ?? v.platform}</span></span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// So the owner can read what the analysis deduced: one short French sentence per decision.
const theme = (s: string) => s.split(" | ")[0]!.replace(/\s*\(.*$/, "");
const DECISION_FR: Record<string, string> = {
  trend_sources: "Tendances : on cherche sur YouTube et TikTok, et on choisit d'abord selon nos résultats Instagram",
  themes: "Stratégiste : thèmes de la semaine revus (plan ci-dessus)",
};

function decisionText(d: Stats["decisions"][number]): string {
  if (d.kind === "slots") return `Heures de sortie : ${(d.from ?? []).join(" / ")} → ${(d.to ?? []).join(" / ")}`;
  if (d.kind === "lesson") return `Nouvelle règle (Lester) : ${d.rule ?? ""}`;
  return DECISION_FR[d.kind] ?? d.kind;
}

export function StatsCharts({ state, now }: { state: StudioState | null; now: number }) {
  const s = state?.stats;
  if (!s) return <p className="sp-meta">Pas encore de chiffres.</p>;
  const age = s.followers_at ? Math.round((now - Date.parse(s.followers_at)) / 60_000) : null;
  return (
    <div className="cc st">
      <NetTiles totals={s.totals} />
      <p className="cc-legend">{NETS.map((n) => <span key={n.id}><i style={{ background: n.color }} />{n.label} </span>)}</p>
      <ViewsCurve series={s.series} />
      <p className="cc-caption">vues cumulées de nos vidéos, 7 derniers jours{age !== null && age >= 90 ? ` · relevé il y a ${Math.round(age / 60)} h` : ""}</p>
      <h3 className="st-h">Top 5</h3>
      <TopVideos top={s.top} hookPrefix={state?.concept?.active?.hook_prefix} />
      {s.decisions.length ? (
        <>
          <h3 className="st-h">Ce que l'équipe a décidé</h3>
          {s.plan ? (
            <p className="st-plan">
              Plan de la semaine : on pousse {s.plan.push.map(theme).join(", ")} · on évite {s.plan.drop.map(theme).join(", ")}
            </p>
          ) : null}
          <ul className="st-dec">
            {s.decisions.map((d) => (
              <li key={`${d.at}${d.kind}`}>
                <span className="st-when">{new Intl.DateTimeFormat("fr-FR", { timeZone: globalThis.STUDIO_TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(Date.parse(d.at))}</span>
                {decisionText(d)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
