// Live-only blocks of the side panel: videos in production (stage bar + shot-by-shot render), the team with each
// agent's model, the PC schedule with today's runs, and the last problems. Everything comes from /api/state; nothing
// here is invented, and an unknown value shows as "—".

import { agentName, CHIEF_ID, TEAMS } from "../room/cast";
import { clockIn, duration, relTime, statusLabel } from "../live/format";
import { VIDEO_STEPS, type AgentRow, type ErrorRow, type RenderRow, type RunsToday, type Schedule } from "../live/types";

export function Steps({ status }: { status: string }) {
  const at = VIDEO_STEPS.indexOf(status as (typeof VIDEO_STEPS)[number]);
  return (
    <div className="sp-steps" role="img" aria-label={`Status: ${statusLabel(status)}`}>
      <div className="sp-bar">
        {VIDEO_STEPS.map((s, i) => (
          <i key={s} title={statusLabel(s)} className={i < at ? "is-done" : i === at ? "is-now" : ""} />
        ))}
      </div>
      <div className="sp-step-ends">
        <span>Idea</span>
        <b>{statusLabel(status)}</b>
        <span>Published</span>
      </div>
    </div>
  );
}

// ---------- videos in production ----------

const needsClip = (s: RenderRow["shots"][number]): boolean => s.needs_clip !== false;
const clipsNeeded = (r: RenderRow): number => r.clips_needed ?? r.shots_total;

function shotTitle(s: RenderRow["shots"][number]): string {
  if (!needsClip(s) && !s.clip) return `Shot ${s.n}: ${s.no_clip_reason ?? "still"}, no Wan clip needed`;
  const kf = s.keyframe ? "keyframe picked" : s.candidates ? `${s.candidates} candidates, no pick yet` : "no keyframe yet";
  const clip = s.clip ? "clip done" : s.rejected_takes ? `${s.rejected_takes} take rejected, new take needed` : "clip not rendered yet";
  return `Shot ${s.n}: ${kf} · ${clip}`;
}

function etaText(r: RenderRow): string | null {
  if (!r.shots_total) return null;
  if (r.clips_done >= clipsNeeded(r)) return "All clips rendered.";
  if (r.eta_s === null) return "No clip timing yet, so no estimate.";
  const per = r.avg_clip_s !== null ? ` at ${duration(r.avg_clip_s)} a clip (${r.avg_clip_source})` : "";
  return `About ${duration(r.eta_s)} of GPU time left${per}${r.eta_partial ? ", keyframes not counted" : ""}.`;
}

export function RenderCard({ r, now }: { r: RenderRow; now: number }) {
  const total = r.shots_total;
  return (
    <div className="sp-video sp-render">
      <p className="sp-video-topic">{r.title || r.video_id}</p>
      <p className="sp-meta">
        <span className="wr-num">{r.video_id}</span>
        {r.status_source === "files" ? " · stage read from its files" : ""}
      </p>
      <Steps status={r.status} />
      {total ? (
        <>
          <div className="sp-shots" role="list" aria-label="Shots">
            {r.shots.map((s) => (
              <span key={s.n} role="listitem" className={`sp-shot${s.clip || !needsClip(s) ? " is-clip" : s.keyframe ? " is-key" : ""}${!s.clip && needsClip(s) && s.rejected_takes ? " is-retake" : ""}`} title={shotTitle(s)}>
                {String(s.n).padStart(2, "0")}
              </span>
            ))}
          </div>
          <dl className="sp-facts">
            <div>
              <dt>Keyframes picked</dt>
              <dd className="wr-num">
                {r.keyframes_picked} / {total}
              </dd>
            </div>
            <div>
              <dt>Clips done</dt>
              <dd className="wr-num">
                {r.clips_done} / {clipsNeeded(r)}
                {clipsNeeded(r) < total ? <small> · {total - clipsNeeded(r)} without Wan</small> : null}
                {r.rejected_takes ? <small> · {r.rejected_takes} take rejected</small> : null}
              </dd>
            </div>
          </dl>
          <p className="sp-meta">{etaText(r)}</p>
          {r.last_file_at ? (
            <p className="sp-meta">
              {r.rendering_now ? <span className="sp-live-dot" aria-hidden="true" /> : null}
              Last file {relTime(r.last_file_at, now)}
              {r.rendering_now ? " (rendering)" : ""}
            </p>
          ) : null}
        </>
      ) : (
        <p className="sp-meta">No keyframes or clips yet.</p>
      )}
    </div>
  );
}

// ---------- team ----------

const STATE_LABEL: Record<string, string> = { working: "Working", waiting: "Waiting", error: "Problem", idle: "Idle" };

function AgentLine({ a }: { a: AgentRow }) {
  const model = a.model ? `${a.model}${a.effort ? ` · ${a.effort}` : ""}` : null;
  return (
    <li className={`sp-agent s-${a.state}`} tabIndex={0} title={model ? `${agentName(a.id)} — model ${a.model}, effort ${a.effort ?? "—"}` : agentName(a.id)}>
      <span className="sp-agent-dot" aria-hidden="true" />
      <span className="sp-agent-name">{agentName(a.id)}</span>
      <span className="sp-agent-task">{a.task || STATE_LABEL[a.state] || a.state}</span>
      {model ? <span className="sp-model">{model}</span> : null}
    </li>
  );
}

export function TeamList({ agents }: { agents: AgentRow[] }) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const order = [CHIEF_ID, ...TEAMS.flatMap((t) => t.robots)];
  const rows = order.map((id) => byId.get(id)).filter((a): a is AgentRow => !!a);
  for (const a of agents) if (!order.includes(a.id)) rows.push(a);
  const busy = rows.filter((a) => a.state !== "idle");
  const idle = rows.filter((a) => a.state === "idle");
  if (!rows.length) return <p className="sp-empty">No agents in the database yet.</p>;
  return (
    <>
      {busy.length ? (
        <ul className="sp-list sp-agents">
          {busy.map((a) => (
            <AgentLine key={a.id} a={a} />
          ))}
        </ul>
      ) : (
        <p className="sp-empty">Everyone is idle.</p>
      )}
      {idle.length ? (
        <details className="sp-more">
          <summary>
            {idle.length} idle {idle.length === 1 ? "agent" : "agents"}
          </summary>
          <ul className="sp-list sp-agents">
            {idle.map((a) => (
              <AgentLine key={a.id} a={a} />
            ))}
          </ul>
        </details>
      ) : null}
      <p className="sp-meta">Hover or tap a name for its model and effort.</p>
    </>
  );
}

// ---------- PC schedule ----------

function RunsBar({ runs }: { runs: RunsToday }) {
  const pct = runs.max ? Math.min(100, Math.round((runs.used / runs.max) * 100)) : 0;
  return (
    <div className="sp-runs">
      <div className="sp-runs-head">
        <span>Runs today</span>
        <b className="wr-num">
          {runs.used} / {runs.max ?? "—"}
        </b>
      </div>
      <div className={`sp-meter${pct >= 90 ? " is-high" : ""}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="sp-meta">
        Counted by UTC day ({runs.date}){runs.rate_limited ? ` · ${runs.rate_limited} hit the limit` : ""}
        {runs.failed ? ` · ${runs.failed} failed` : ""}
      </p>
    </div>
  );
}

export function ScheduleBlock({ s, runs, log, now }: { s: Schedule | undefined; runs: RunsToday | undefined; log: { file: string; at: string | null; tail: string[] } | null | undefined; now: number }) {
  const tz = s?.timezone ?? globalThis.STUDIO_TZ;
  const mode = s?.active === true ? "ON" : s?.active === false ? "OFF" : "not set";
  return (
    <>
      <div className="sp-mode">
        <span>Automatic mode</span>
        <b className={`sp-pill${s?.active === true ? " is-on" : ""}`}>{mode}</b>
      </div>
      {s?.active !== true ? <p className="sp-meta">Nothing starts by itself. The times below are what the schedule would do.</p> : s?.activated ? <p className="sp-meta">{s.activated}</p> : null}
      <dl className="sp-facts sp-sched">
        <div>
          <dt>Next render window</dt>
          <dd>
            {s?.render_open_now ? "Open now" : s?.next_render ? clockIn(s.next_render, tz, now) : "—"}
            {s?.window ? (
              <small>
                {" "}
                ({s.window.start}–{s.window.end}
                {s.max_renders_per_window ? `, up to ${s.max_renders_per_window} renders` : ""})
              </small>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Next script phase</dt>
          <dd>{s?.next_script ? clockIn(s.next_script, tz, now) : "—"}</dd>
        </div>
        <div>
          <dt>No new render after</dt>
          <dd>{s?.no_new_render_after ?? "—"}</dd>
        </div>
        <div>
          <dt>Quiet hours</dt>
          <dd>
            {s?.quiet_hours ? `${s.quiet_hours.start}–${s.quiet_hours.end}` : "—"}
            {s?.in_quiet_hours ? <small> (now)</small> : null}
          </dd>
        </div>
      </dl>
      {s && s.days.length < 7 ? <p className="sp-meta">Work days: {s.days.join(", ")}</p> : null}
      <p className="sp-meta">Times in {tz.replace("_", " ")}.</p>
      {runs ? <RunsBar runs={runs} /> : null}
      {log ? (
        <div className="sp-log">
          <p className="sp-meta">
            Last daily run log {log.at ? relTime(log.at, now) : ""} ({log.file})
          </p>
          {log.tail.map((l, i) => (
            <code key={i}>{l}</code>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ---------- problems ----------

export function ProblemList({ errors, agents, now }: { errors: ErrorRow[]; agents: AgentRow[]; now: number }) {
  const stuck = agents.filter((a) => a.state === "error");
  if (!errors.length && !stuck.length) return <p className="sp-empty">No problems reported.</p>;
  return (
    <ol className="sp-list sp-recent sp-problems">
      {stuck.map((a) => (
        <li key={`a-${a.id}`}>
          <span className="sp-dot k-error" />
          <span className="sp-text">
            {agentName(a.id)} is stuck{a.task ? `: ${a.task}` : ""}
          </span>
          <time>{relTime(a.updated_at, now)}</time>
        </li>
      ))}
      {errors.map((e) => (
        <li key={e.id}>
          <span className="sp-dot k-error" />
          <span className="sp-text">
            {e.agent ? agentName(e.agent) : "Studio"}: {e.text || "no detail"}
          </span>
          <time>{relTime(e.at, now)}</time>
        </li>
      ))}
    </ol>
  );
}
