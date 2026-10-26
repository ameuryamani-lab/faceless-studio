// Adapted from AttentionOS (MIT licence, Copyright (c) 2026 The AttentionOS Authors), commit 89f6781,
// apps/studio/src/components/worker-room/use-live-room.ts. See licences/ATTENTIONOS-LICENSE.
// Changes for Faceless Studio: one desk per real agent (21 agents + the Chief), driven by the agents table and the
// events table. Nothing here is simulated: a desk works only while its agent's state is 'working' or a run_start
// event for it has not been closed by a run_end, and every packet in the air was caused by a real event:
//   run_start → a spark from the Brand Brain to the desk (and the job ticket, if no handoff brought it)
//   run_end   → a check back to the Chief (unless the agent hands the work straight on)
//   handoff   → a ticket from agent to to_agent
//   approval_request → a ticket to the Chief
//   approval_decision → a check from the Chief
//   publish   → a post flying to the "Our channel" wall

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLive } from "../live/source";
import type { AgentRow, EventRow } from "../live/types";
import { ALL_ROBOTS, CHIEF_ID, isRobot, TEAM_OF, TEAMS, type RobotId, type TeamId } from "./cast";
import { createClock } from "./clock";
import { WALL_PHONES, type Place } from "./layout";
import { P } from "./palette";
import type { DeskLive, DeskStatus, Desks, Flight, FlightKind, RoomState, TeamLive } from "./types";

/** One desk screen story, in ms. Matches --w in worker-room.css. */
export const CYCLE = 3600;
// 2026-10-22: slower, so the order card can be followed from desk to desk (and by the camera of the promo).
const FLY = 1700;
const SPARK = 850;
/** A run that starts this soon after a handoff to it was already delivered by that handoff's packet. */
const HANDOFF_GRACE = 8000;
/** A run_end followed this soon by a handoff from the same agent sends no extra check to the Chief. */
const HANDOFF_AFTER_END = 600;
/** An error event lights the desk red this long (the agents table can keep it red longer). */
const ERROR_MS = 10_000;
/** A run_start never closed by a run_end stops counting after this long. */
const STALE_RUN_MS = 30 * 60_000;

function roomState(state: AgentRow["state"] | undefined): RoomState {
  if (state === "working") return "working";
  if (state === "waiting") return "waiting";
  if (state === "error") return "blocked";
  return "idle";
}

function deskStatus(state: RoomState): DeskStatus {
  if (state === "working") return "work";
  if (state === "waiting") return "wait";
  if (state === "blocked") return "block";
  return "idle";
}

const placeOf = (agent: string | null | undefined): Place | null => {
  if (agent === CHIEF_ID) return "chief";
  return isRobot(agent) ? agent : null;
};

export interface LiveRoom {
  teams: Record<TeamId, TeamLive>;
  chief: { state: RoomState; label: string; status: DeskStatus; to: Place | null };
  desks: Desks;
  /** What each desk's agent is doing, for its tag. */
  tasks: Partial<Record<RobotId, string>>;
  flights: readonly Flight[];
  ticket: { key: number; label: string } | null;
  wall: { shifts: number[]; flashes: number[] };
  working: number;
  total: number;
  clock: ReturnType<typeof createClock>;
}

export function useLiveRoom(still: boolean): LiveRoom {
  const live = useLive();
  const agents = live.state?.agents ?? [];
  const clock = useMemo(() => createClock(), []);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [ticket, setTicket] = useState<{ key: number; label: string } | null>(null);
  const [wall, setWall] = useState<{ shifts: number[]; flashes: number[] }>(() => ({ shifts: Array(WALL_PHONES).fill(0), flashes: Array(WALL_PHONES).fill(0) }));
  const [tick, setTick] = useState(0);

  const sending = useRef(new Map<Place, { until: number; to: Place }>());
  /** Runs opened by run_start events and not closed yet: agent → start time. */
  const running = useRef(new Map<string, { since: number; task: string }>());
  const errors = useRef(new Map<string, number>());
  const deskStart = useRef(new Map<string, number>());
  const lastHandoffTo = useRef<Record<string, number>>({});
  const lastHandoffFrom = useRef<Record<string, number>>({});
  const lastRunStart = useRef<Record<string, number>>({});
  const posts = useRef(0);
  const seq = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const stillRef = useRef(still);
  stillRef.current = still;

  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);
  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const t of set) clearTimeout(t);
      set.clear();
    };
  }, []);

  const launch = useCallback(
    (kind: FlightKind, from: Place, to: Place, opts: { tint?: string; label?: string; phone?: number; dur?: number; onLand?: () => void } = {}) => {
      if (stillRef.current) {
        opts.onLand?.();
        return;
      }
      const dur = opts.dur ?? (kind === "read" || kind === "scan" ? SPARK : FLY);
      const f: Flight = { id: `f${++seq.current}`, kind, from, to, start: clock.now(), dur, tint: opts.tint ?? P.pink, label: opts.label, phone: opts.phone };
      setFlights((prev) => [...prev, f]);
      setTick((n) => n + 1);
      later(dur + 40, () => {
        setFlights((prev) => prev.filter((x) => x.id !== f.id));
        opts.onLand?.();
      });
    },
    [clock, later],
  );

  const send = useCallback((from: Place, to: Place) => {
    sending.current.set(from, { until: performance.now() + FLY, to });
    setTick((n) => n + 1);
  }, []);

  const handle = useCallback(
    (e: EventRow) => {
      const now = performance.now();
      const agent = e.agent ?? "";
      const from = placeOf(agent);
      switch (e.kind) {
        case "run_start": {
          running.current.set(agent, { since: now, task: e.text ?? "" });
          errors.current.delete(agent);
          lastRunStart.current[agent] = now;
          if (from === "chief") {
            launch("read", "core", "chief");
            break;
          }
          if (!isRobot(agent)) break;
          launch("read", "core", agent);
          later(650, () => {
            if (performance.now() - (lastHandoffTo.current[agent] ?? -Infinity) < HANDOFF_GRACE) return;
            const team = TEAM_OF[agent]!;
            if (agent === "trend_scout" || agent === "outlier_analyst") {
              launch("scan", "wallR", agent, { phone: agent === "trend_scout" ? 2 : 4 });
              return;
            }
            send("chief", agent);
            setTicket({ key: ++seq.current, label: team.ticket });
            launch("job", "chief", agent, { tint: team.tint, label: team.ticket });
          });
          break;
        }
        case "run_end": {
          running.current.delete(agent);
          if (!from) break;
          later(HANDOFF_AFTER_END, () => {
            if (performance.now() - (lastHandoffFrom.current[agent] ?? -Infinity) < HANDOFF_AFTER_END + 200) return;
            if (from === "chief") return;
            send(from, "chief");
            launch("done", from, "chief", { tint: TEAM_OF[agent]?.tint ?? P.pink });
          });
          break;
        }
        case "handoff": {
          const to = placeOf(e.to_agent);
          lastHandoffFrom.current[agent] = now;
          if (!to || !from || from === to) break;
          if (e.to_agent) lastHandoffTo.current[e.to_agent] = now;
          const team = e.to_agent ? TEAM_OF[e.to_agent] : undefined;
          const sameTeam = !!team && TEAM_OF[agent]?.id === team.id;
          const label = to === "chief" ? "Bilan" : (team?.ticket ?? "Ordre");
          send(from, to);
          if (from === "chief") setTicket({ key: ++seq.current, label });
          // Every hand-off is the glowing order card, inside a team too (orders visibly walk from one agent to the next).
          void sameTeam;
          launch("job", from, to, { tint: team?.tint ?? P.pink, label });
          break;
        }
        case "approval_request": {
          const src: Place = from && from !== "chief" ? from : "core";
          send(src, "chief");
          launch("job", src, "chief", { tint: P.amber, label: "Approval" });
          break;
        }
        case "approval_decision": {
          const to = placeOf(e.to_agent);
          if (to && to !== "chief") {
            send("chief", to);
            launch("done", "chief", to, { tint: P.pink });
          } else launch("read", "core", "chief");
          break;
        }
        case "publish": {
          const src: Place = from ?? "publisher";
          const k = posts.current++ % WALL_PHONES;
          send(src, "wallL");
          launch("post", src, "wallL", {
            phone: k,
            onLand: () =>
              setWall((w) => ({
                shifts: w.shifts.map((s, i) => (i === k ? s + 1 : s)),
                flashes: w.flashes.map((f, i) => (i === k ? Date.now() : f)),
              })),
          });
          break;
        }
        case "error": {
          if (agent) errors.current.set(agent, now + ERROR_MS);
          running.current.delete(agent);
          setTick((n) => n + 1);
          break;
        }
        default:
          break;
      }
    },
    [launch, later, send],
  );

  useEffect(() => live.onEvent(handle), [live.onEvent, handle]);

  // Agents that start working in the table without a run_start event still get their spark from the brain.
  const prev = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const now = performance.now();
    const before = prev.current;
    prev.current = new Map(agents.map((a) => [a.id, a.state]));
    if (!before) return;
    for (const a of agents) {
      const was = before.get(a.id);
      if (a.state !== "working" || was === "working" || was === undefined) continue;
      if (now - (lastRunStart.current[a.id] ?? -Infinity) < 5000) continue;
      const p = placeOf(a.id);
      if (p) launch("read", "core", p);
    }
  }, [agents, launch]);

  // While anything works or flies, tick a few times a second so desk screens replay their story.
  const anyWorking = agents.some((a) => a.state === "working") || running.current.size > 0;
  useEffect(() => {
    if (!anyWorking && flights.length === 0 && sending.current.size === 0 && errors.current.size === 0) return;
    const id = setInterval(() => {
      const now = performance.now();
      for (const [k, v] of sending.current) if (v.until <= now) sending.current.delete(k);
      for (const [k, v] of errors.current) if (v <= now) errors.current.delete(k);
      for (const [k, v] of running.current) if (now - v.since > STALE_RUN_MS) running.current.delete(k);
      setTick((x) => x + 1);
    }, 250);
    return () => clearInterval(id);
  }, [anyWorking, flights.length]);

  return useMemo(() => {
    void tick;
    const now = performance.now();
    const byId = new Map(agents.map((a) => [a.id, a]));
    const stateOf = (id: string): RoomState => {
      if ((errors.current.get(id) ?? 0) > now) return "blocked";
      const row = byId.get(id);
      if (running.current.has(id)) return "working";
      return roomState(row?.state);
    };
    const taskOf = (id: string): string => byId.get(id)?.task ?? running.current.get(id)?.task ?? "";

    const desks = {} as Record<RobotId, DeskLive>;
    const tasks: Partial<Record<RobotId, string>> = {};
    for (const r of ALL_ROBOTS) {
      const state = stateOf(r);
      if (state === "working") {
        if (!deskStart.current.has(r)) deskStart.current.set(r, now);
      } else deskStart.current.delete(r);
      const s = sending.current.get(r);
      let status = deskStatus(state);
      if (s && s.until > now && (status === "work" || status === "idle")) status = "send";
      const t0 = deskStart.current.get(r);
      const cycle = state === "working" && t0 !== undefined && !still ? Math.floor((now - t0) / CYCLE) : 0;
      desks[r] = { status, cycle, to: s && s.until > now ? s.to : null };
      if (state !== "idle") tasks[r] = taskOf(r);
    }

    const teams = {} as Record<TeamId, TeamLive>;
    for (const team of TEAMS) {
      const states = team.robots.map(stateOf);
      const state: RoomState = states.includes("blocked") ? "blocked" : states.includes("working") ? "working" : states.includes("waiting") ? "waiting" : "idle";
      const lead = team.robots.find((r) => stateOf(r) === state);
      teams[team.id] = { team: team.id, state, name: team.name, label: lead ? taskOf(lead) : "", pending: 0 };
    }

    const chiefState = stateOf(CHIEF_ID);
    const cs = sending.current.get("chief");
    const chiefSending = !!cs && cs.until > now;
    const working = [CHIEF_ID, ...ALL_ROBOTS].filter((id) => stateOf(id) === "working").length;
    return {
      teams,
      chief: { state: chiefState, label: taskOf(CHIEF_ID), status: chiefSending ? "send" : deskStatus(chiefState), to: chiefSending ? cs.to : null },
      desks,
      tasks,
      flights,
      ticket,
      wall,
      working,
      total: ALL_ROBOTS.length + 1,
      clock,
    };
  }, [tick, agents, flights, ticket, wall, clock, still]);
}
