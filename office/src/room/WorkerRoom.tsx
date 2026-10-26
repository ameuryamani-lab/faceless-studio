// Adapted from AttentionOS (MIT licence, Copyright (c) 2026 The AttentionOS Authors), commit 89f6781,
// apps/studio/src/components/worker-room/WorkerRoom.tsx. See licences/ATTENTIONOS-LICENSE.
// Changes for Faceless Studio: no Next.js, our roster (7 teams + the Chief), walls "Our channel" and "Trending",
// a DEMO badge, and the full screen button always offered when the browser supports it.
// The worker room: a dark isometric room where each agent has a desk, the Chief of Staff runs the floor from a dais
// and the Brand Brain glows in the middle. One SVG on a stage that the camera moves with a single CSS transform.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLive } from "../live/source";
import { CHIEF_NAME, ROBOT_NAME, TEAMS, type RobotId, type TeamId } from "./cast";
import { fitCamera, MOVE_MS, overlaps, STOPS, visibleRect } from "./camera";
import { ChiefDais } from "./ChiefDais";
import { Core } from "./Core";
import { Defs } from "./Defs";
import { Flights } from "./Flights";
import { grouped, iso } from "./iso";
import { anchor, CHIEF, CORE, FRAMES, ROOM_TALL, SPOTS, VIEW, type Place, type StopId } from "./layout";
import { P } from "./palette";
import type { Dir } from "./Robot";
import { CoversContext } from "./screens/bits";
import { Shell } from "./Shell";
import { Station } from "./Station";
import { statusText, Tag, TeamTags } from "./TeamTags";
import type { Fullscreen } from "./use-fullscreen";
import { useLiveRoom } from "./use-live-room";
import { useTour } from "./use-tour";
import { WallFeed } from "./WallFeed";
import { Walls } from "./Walls";
import type { RoomState, WallFeedData } from "./types";
import "./worker-room.css";

function dirTo(from: Place, to: Place | null): Dir {
  if (!to) return "0";
  const dx = anchor(to)[0] - anchor(from)[0];
  return Math.abs(dx) < 6 ? "0" : dx > 0 ? "r" : "l";
}

/** Space the bars need, so the camera keeps its subject clear of them. */
function safeArea(w: number, h: number, wide: boolean): { top: number; bottom: number } {
  const phone = w < 720 || h > w;
  if (phone) return { top: 52, bottom: 96 };
  return wide ? { top: 44, bottom: 56 } : { top: 60, bottom: 64 };
}

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((p) => (p.w === r.width && p.h === r.height ? p : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Honors the system "reduce motion" setting: a still room. */
function useReducedMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return still;
}

interface FloorItem {
  key: string;
  depth: number;
  node: ReactNode;
}

export function WorkerRoom({ feed, full, hold: startHeld = true, extra }: { feed: WallFeedData; full?: Fullscreen; hold?: boolean; extra?: ReactNode }) {
  const live = useLive();
  const still = useReducedMotion();
  const room = useLiveRoom(still);
  const tour = useTour(startHeld, still);
  const box = useRef<HTMLDivElement>(null);
  const size = useSize(box);
  const { jump, step, toggleHold } = tour;

  const stop = tour.hold ? STOPS[0]! : tour.stop;
  const viewport = useMemo(() => ({ w: size.w, h: size.h, ...safeArea(size.w, size.h, stop.id === "room") }), [size, stop.id]);
  const tall = viewport.h > viewport.w * 1.25;
  const pose = useMemo(() => fitCamera(stop.id === "room" && tall ? ROOM_TALL : FRAMES[stop.id], VIEW, viewport), [stop.id, tall, viewport]);
  const seen = useMemo(() => visibleRect(pose, VIEW, viewport), [pose, viewport]);
  const sees = useCallback((id: StopId) => overlaps(seen, FRAMES[id]), [seen]);

  const pickRobot = useCallback((id: RobotId) => jump(SPOTS[id].team), [jump]);
  const pickChief = useCallback(() => jump("chief"), [jump]);
  const pickBrain = useCallback(() => jump("brain"), [jump]);
  const pickFeed = useCallback(() => jump("feed"), [jump]);
  const pickTrending = useCallback(() => jump("trending"), [jump]);

  // ?follow=1 (the promo film, 2026-10-22): the camera follows the order card to the team that receives it, and goes to
  // "Our channel" when a video is published. Off by default: the normal vitrine keeps its own tour.
  const follow = useMemo(() => new URLSearchParams(window.location.search).get("follow") === "1", []);
  useEffect(() => {
    if (!follow) return undefined;
    return live.onEvent((e) => {
      const target = e.kind === "handoff" ? e.to_agent : e.kind === "run_start" ? e.agent : null;
      if (e.kind === "publish") jump("feed");
      else if (target === "chief_of_staff") jump("chief");
      else if (target && target in SPOTS) jump(SPOTS[target as RobotId].team);
    });
  }, [follow, live.onEvent, jump]);

  const states = useMemo(() => Object.fromEntries(TEAMS.map((t) => [t.id, room.teams[t.id].state])) as Record<TeamId, RoomState>, [room.teams]);
  const covers = useMemo(() => feed.cards.map((c) => c.cover).filter((c): c is string => !!c), [feed.cards]);

  const floor: FloorItem[] = [
    {
      key: "chief",
      depth: CHIEF.x + CHIEF.y,
      node: <ChiefDais status={room.chief.status} dir={dirTo("chief", room.chief.to)} ticket={room.ticket} tint={room.ticket ? (TEAMS.find((t) => t.ticket === room.ticket?.label)?.tint ?? P.pink) : P.pink} off={!sees("chief")} onPick={pickChief} />,
    },
    {
      key: "core",
      depth: CORE.x + CORE.y,
      node: (
        <g onClick={pickBrain} className="wr-pick">
          <Core busy={room.working > 0} off={!sees("brain")} />
        </g>
      ),
    },
    ...TEAMS.flatMap((team, ti) =>
      team.robots.map((id, i) => {
        const spot = SPOTS[id];
        const d = room.desks[id];
        return {
          key: id,
          depth: spot.cx + spot.cy,
          node: <Station spot={spot} name={ROBOT_NAME[id]} work={live.state?.desk_work?.[id]} tint={team.tint} status={d.status} cycle={d.cycle} dir={dirTo(id, d.to)} breath={(i * 1.3 + ti * 0.7) % 4} off={!sees(team.id)} onPick={pickRobot} />,
        };
      }),
    ),
  ].sort((a, b) => a.depth - b.depth);

  const ready = size.w > 0 && size.h > 0;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!ready || armed) return;
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, [ready, armed]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "h" || e.key === "H") toggleHold();
    else if ((e.key === "f" || e.key === "F") && full?.supported) full.toggle();
    else return;
    e.preventDefault();
  };

  // Wall tickers. Never a real handle: the left wall is simply "Our channel".
  const totals = feed.totalPosts ? `   ${grouped(feed.totalViews)} VUES   ${grouped(feed.totalPosts)} ${feed.totalPosts === 1 ? "VIDÉO" : "VIDÉOS"}` : "";
  const wallLeft = `NOTRE CHAÎNE${totals}`;
  const usableLine = typeof feed.trendUsable === "number" && feed.trendTotal ? `   ${feed.trendUsable}/${feed.trendTotal} UTILISABLES` : "";
  const wallRight = feed.trending.length ? `TENDANCES${usableLine}` : "TENDANCES";
  const line = captionFor(stop.id, stop.line, room);
  const [hx, hy] = iso(CHIEF.x, CHIEF.y, CHIEF.z + 0.55);
  const chiefText = statusText({ team: "research", state: room.chief.state, name: CHIEF_NAME, label: room.chief.label, pending: 0 });

  return (
    <div className={`wr${still ? " is-still" : ""}`} onKeyDown={onKey} tabIndex={0} aria-label="Faceless Studio office. Arrow keys move the camera, H holds the wide shot, F goes full screen.">
      <div className="wr-room" ref={box}>
        <div
          className="wr-stage"
          style={{
            width: VIEW.w,
            height: VIEW.h,
            transform: `translate(${pose.tx.toFixed(2)}px, ${pose.ty.toFixed(2)}px) scale(${pose.k.toFixed(4)})`,
            transitionDuration: still || !armed ? "0ms" : `${MOVE_MS}ms`,
            visibility: ready ? "visible" : "hidden",
          }}
        >
          <CoversContext.Provider value={covers}>
            <svg viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} width={VIEW.w} height={VIEW.h} role="img" aria-label={roomLabel(room)}>
              <Defs />
              <Shell states={states} chief={room.chief.state} />
              <Walls right={wallRight} left={wallLeft} />
              <WallFeed cards={feed.cards} trending={feed.trending} shifts={room.wall.shifts} flashes={room.wall.flashes} focus={stop.id} onPickChannel={pickFeed} onPickTrending={pickTrending} />
              {floor.map((f) => (
                <g key={f.key}>{f.node}</g>
              ))}
              <TeamTags teams={room.teams} />
              {chiefText ? <Tag x={hx} y={hy - 166} name="Chief" text={chiefText.length > 36 ? `${chiefText.slice(0, 35)}…` : chiefText} state={room.chief.state} tint={P.pink} /> : null}
              {!still && <Flights flights={room.flights} clock={room.clock} />}
            </svg>
          </CoversContext.Provider>
        </div>
      </div>

      <header className="wr-topbar">
        <div className="wr-brand">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
            <circle cx="11" cy="11" r="10.5" fill="#0b0712" />
            <path d="M 15.6 4.6 A 7 7 0 1 1 11.6 4.03" fill="none" stroke={P.magenta} strokeWidth="2.4" />
          </svg>
          <span>Faceless Studio</span>
          {live.demo ? <em className="wr-demo">DEMO</em> : null}
        </div>
        <div className="wr-top-right">
          {!live.demo && !live.connected ? <span className="wr-offline">Reconnexion…</span> : null}
          <div className="wr-live" aria-live="polite">
            <i className={`wr-live-dot${room.working ? " is-on" : ""}`} />
            <b className="wr-num">{room.working}</b>
            <span className="wr-live-of">sur {room.total}</span>
            <span>{room.working === 1 ? "agent au travail" : "agents au travail"}</span>
          </div>
          {extra}
        </div>
      </header>

      <footer className="wr-tourbar">
        <p className="wr-caption" key={line}>
          {line}
        </p>
        <nav className="wr-stops" aria-label="Camera">
          {STOPS.map((s, i) => (
            <button key={s.id} type="button" className={`wr-stop${i === tour.index && !tour.hold ? " is-on" : ""}${isLive(s.id, room) ? " is-live" : ""}`} aria-pressed={i === tour.index && !tour.hold} aria-label={`Show ${s.label}`} onClick={() => jump(s.id)}>
              <i />
              <span>{s.label}</span>
            </button>
          ))}
          <button type="button" className={`wr-hold${tour.paused ? " is-on" : ""}`} aria-pressed={tour.paused} onClick={toggleHold}>
            {tour.paused ? "Visite" : "Vue large"}
          </button>
          {full?.supported ? (
            <button type="button" className={`wr-hold wr-full${full.active ? " is-on" : ""}`} aria-pressed={full.active} onClick={full.toggle}>
              {full.active ? "Quitter le plein écran" : "Plein écran"}
            </button>
          ) : null}
        </nav>
      </footer>
    </div>
  );
}

type Room = ReturnType<typeof useLiveRoom>;

function isLive(id: StopId, room: Room): boolean {
  if (id === "chief") return room.chief.state === "working";
  const t = TEAMS.find((x) => x.id === id);
  return !!t && room.teams[t.id].state === "working";
}

function captionFor(id: StopId, fallback: string, room: Room): string {
  if (id === "room") return room.working ? `${room.working} ${room.working === 1 ? "agent" : "agents"} au travail.` : fallback;
  if (id === "chief") {
    if (room.chief.state === "working" && room.chief.label) return `${CHIEF_NAME}: ${room.chief.label}`;
    if (room.chief.state === "waiting") return `${CHIEF_NAME} attend.`;
    return fallback;
  }
  const team = TEAMS.find((t) => t.id === id);
  if (!team) return fallback;
  const t = room.teams[team.id];
  if (t.state === "working" && t.label) return `${t.name}: ${t.label}`;
  if (t.state === "waiting") return `${t.name} attend.`;
  if (t.state === "blocked") return `${t.name} : un problème.`;
  return fallback;
}

function roomLabel(room: Room): string {
  const busy = TEAMS.filter((t) => room.teams[t.id].state === "working").map((t) => room.teams[t.id].name);
  return busy.length ? `The office. Working now: ${busy.join(", ")}.` : "The office. The agents are between tasks.";
}
