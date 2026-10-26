// "Consommation Claude" as graphs, live, rather than text:
// two gauges for the owner's Claude plan (5-hour session, week) with their reset countdown, the % of both since midnight, the tokens
// per hour since midnight (studio agents vs other sessions) and the studio's daily run counter as a small ring.

import type { StudioState } from "../live/types";

const PINK = "#ff6fae";
const AMBER = "#ffb547";
const MAGENTA = "#b566ff";
const LILAC = "#7dd3fc";
const DIM = "#6b5a8c";
const tone = (pct: number) => (pct >= 85 ? "#ff5a6e" : pct >= 60 ? AMBER : "#4ade80");

function countdown(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - now;
  if (!(ms > 0)) return "↻ maintenant";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 24 ? `↻ ${Math.floor(h / 24)} j ${h % 24} h` : `↻ ${h} h ${String(m).padStart(2, "0")}`;
}

function Gauge({ pct, label, reset, now, color }: { pct: number | null; label: string; reset: string | null; now: number; color: string }) {
  const r = 46;
  const value = Math.max(0, Math.min(100, pct ?? 0));
  const end = Math.PI * (1 - value / 100);
  const x = 60 + r * Math.cos(end);
  const y = 58 - r * Math.sin(end);
  return (
    <svg viewBox="0 0 120 92" className="cc-gauge" role="img" aria-label={`${label} ${pct ?? "?"} %`}>
      <path d={`M14 58 A${r} ${r} 0 0 1 106 58`} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={11} strokeLinecap="round" />
      {pct !== null && value > 0 ? <path d={`M14 58 A${r} ${r} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth={11} strokeLinecap="round" /> : null}
      {pct !== null && value >= 85 ? <circle cx={106} cy={18} r={5} fill={tone(value)} /> : null}
      <text x={60} y={55} textAnchor="middle" fontSize={22} fontWeight={800} fill="#f4eeff">{pct === null ? "—" : `${pct}%`}</text>
      <text x={60} y={74} textAnchor="middle" fontSize={9.5} fill="#b9a9d6">{label}</text>
      <text x={60} y={87} textAnchor="middle" fontSize={8.5} fill={DIM}>{countdown(reset, now)}</text>
    </svg>
  );
}

function PercentCurve({ samples, since, now }: { samples: { at: string; five_hour: number | null; seven_day: number | null }[]; since: number; now: number }) {
  const W = 300, H = 90, P = 6;
  const span = Math.max(1, now - since);
  const px = (t: number) => P + ((t - since) / span) * (W - 2 * P);
  const py = (v: number) => H - P - (v / 100) * (H - 2 * P);
  const line = (key: "five_hour" | "seven_day") => samples.filter((s) => s[key] !== null).map((s) => `${px(Date.parse(s.at)).toFixed(1)},${py(s[key] as number).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cc-chart" role="img" aria-label="% depuis minuit">
      {[25, 50, 75].map((v) => <line key={v} x1={P} x2={W - P} y1={py(v)} y2={py(v)} stroke="rgba(255,255,255,0.06)" />)}
      <polyline points={line("seven_day")} fill="none" stroke={AMBER} strokeWidth={2.2} strokeLinejoin="round" />
      <polyline points={line("five_hour")} fill="none" stroke={PINK} strokeWidth={2.2} strokeLinejoin="round" />
      {samples[0] ? (
        <g>
          <line x1={px(Date.parse(samples[0].at))} x2={px(Date.parse(samples[0].at))} y1={P} y2={H - P} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
          <text x={px(Date.parse(samples[0].at)) - 4} y={P + 9} textAnchor="end" fontSize={9} fill={DIM}>
            {`depuis ${new Intl.DateTimeFormat("fr-FR", { timeZone: globalThis.STUDIO_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.parse(samples[0].at)).replace(":", " h ")}`}
          </text>
        </g>
      ) : null}
      {samples.map((s) => (s.five_hour !== null ? <circle key={`p${s.at}`} cx={px(Date.parse(s.at))} cy={py(s.five_hour)} r={2.2} fill={PINK} /> : null))}
      {samples.map((s) => (s.seven_day !== null ? <circle key={`a${s.at}`} cx={px(Date.parse(s.at))} cy={py(s.seven_day)} r={2.2} fill={AMBER} /> : null))}
    </svg>
  );
}

function HourBars({ hours }: { hours: { h: number; studio: number; other: number }[] }) {
  const W = 300, H = 90, P = 4;
  const max = Math.max(1, ...hours.map((x) => x.studio + x.other));
  const bw = (W - 2 * P) / 24;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cc-chart" role="img" aria-label="jetons par heure">
      {hours.map((x) => {
        const hs = ((H - 14) * x.studio) / max;
        const ho = ((H - 14) * x.other) / max;
        const left = P + x.h * bw + 1;
        return (
          <g key={x.h}>
            <rect x={left} y={H - 12 - ho} width={bw - 2} height={ho} rx={1.5} fill={LILAC} opacity={0.85} />
            <rect x={left} y={H - 12 - ho - hs} width={bw - 2} height={hs} rx={1.5} fill={MAGENTA} />
          </g>
        );
      })}
      {[0, 6, 12, 18].map((h) => <text key={h} x={P + h * bw + bw / 2} y={H - 2} textAnchor="middle" fontSize={8} fill={DIM}>{`${h}h`}</text>)}
    </svg>
  );
}

/** Studio agent runs per hour since midnight (no daily cap since 2026-10-21). */
function RunBars({ byHour }: { byHour: number[] }) {
  const W = 300, H = 40, P = 4;
  const max = Math.max(1, ...byHour);
  const bw = (W - 2 * P) / 24;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cc-chart" role="img" aria-label="lancements d'agents par heure">
      {byHour.map((n, h) => (n ? <rect key={h} x={P + h * bw + 1} y={H - 4 - ((H - 8) * n) / max} width={bw - 2} height={((H - 8) * n) / max} rx={1.5} fill={MAGENTA} /> : null))}
    </svg>
  );
}

// Same thresholds as core/agents-models.json limits.plan_brake: agents wait above them until the window resets.
const BRAKE = { five_hour: 90, seven_day: 95 };

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(Math.round(n)));

export function ClaudeCharts({ state, now }: { state: StudioState | null; now: number }) {
  const c = state?.claude;
  const latest = c?.plan.latest ?? null;
  const age = latest ? Math.round((now - Date.parse(latest.at)) / 60_000) : null;
  const since = c?.tokens.since ? Date.parse(c.tokens.since) : now - 3_600_000;
  const runs = state?.runs_today;
  return (
    <div className="cc">
      <div className="cc-gauges">
        <Gauge pct={latest?.five_hour?.used_pct ?? null} label="Session 5 h" reset={latest?.five_hour?.resets_at ?? null} now={now} color={PINK} />
        <Gauge pct={latest?.seven_day?.used_pct ?? null} label="Semaine" reset={latest?.seven_day?.resets_at ?? null} now={now} color={AMBER} />
      </div>
      {age !== null && age >= 30 ? <p className="cc-age">il y a {age} min</p> : null}
      {(latest?.five_hour?.used_pct ?? 0) >= BRAKE.five_hour || (latest?.seven_day?.used_pct ?? 0) >= BRAKE.seven_day ? <p className="cc-age">⏸ agents en attente</p> : null}
      <p className="cc-legend"><i style={{ background: PINK }} />session <i style={{ background: AMBER }} />semaine</p>
      <PercentCurve samples={c?.plan.samples ?? []} since={since} now={now} />
      <p className="cc-legend"><i style={{ background: MAGENTA }} />Vidéos (agents du studio) : {k(c?.tokens.studio ?? 0).replace(".", ",")} jetons</p>
      <p className="cc-legend"><i style={{ background: LILAC }} />Construction et réglages (autres sessions Claude sur le PC) : {k(c?.tokens.other ?? 0).replace(".", ",")} jetons</p>
      <HourBars hours={c?.tokens.hours ?? []} />
      <p className="cc-caption">1 barre = 1 heure</p>
      {runs?.by_hour ? (
        <>
          <p className="cc-legend"><i style={{ background: MAGENTA }} />agents : {runs.used}</p>
          <RunBars byHour={runs.by_hour} />
        </>
      ) : null}
    </div>
  );
}
