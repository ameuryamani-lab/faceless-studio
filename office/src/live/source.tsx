// Where the office gets its data. Live mode reads the server (GET /api/state, SSE /api/events); demo mode plays a
// scripted day in the browser. Both expose the same shape, so the room and the panel never know which one they read.
// Inspired by AttentionOS apps/studio/src/lib/use-live.tsx (MIT licence, Copyright (c) 2026 The AttentionOS Authors).

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { startDemo } from "./demo";
import type { EventRow, StudioState } from "./types";

export interface LiveSource {
  state: StudioState | null;
  /** Rolling buffer of recent events, newest last. */
  events: EventRow[];
  connected: boolean;
  demo: boolean;
  /** Subscribe to each new event as it arrives. Returns an unsubscribe. */
  onEvent(fn: (e: EventRow) => void): () => void;
}

const LiveContext = createContext<LiveSource | null>(null);
const MAX_EVENTS = 200;
const STATE_POLL_MS = 3000;
const RETRY_MS = 2000;

function useEventBus() {
  const listeners = useRef(new Set<(e: EventRow) => void>());
  const seen = useRef(new Set<number>());
  const [events, setEvents] = useState<EventRow[]>([]);
  const push = (incoming: EventRow[]) => {
    const fresh = incoming.filter((e) => !seen.current.has(e.id));
    if (!fresh.length) return;
    for (const e of fresh) seen.current.add(e.id);
    if (seen.current.size > MAX_EVENTS * 5) seen.current = new Set([...seen.current].slice(-MAX_EVENTS * 2));
    setEvents((prev) => [...prev, ...fresh].slice(-MAX_EVENTS));
    for (const e of fresh) for (const fn of listeners.current) fn(e);
  };
  const onEvent = (fn: (e: EventRow) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  };
  return { events, push, onEvent, seen };
}

/** Real data from office/server.mjs. Read-only: this page never writes anything. */
function ServerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState | null>(null);
  const [connected, setConnected] = useState(false);
  const bus = useEventBus();
  const pushRef = useRef(bus.push);
  pushRef.current = bus.push;

  useEffect(() => {
    let alive = true;
    let lastId: number | null = null;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refetch: ReturnType<typeof setTimeout> | undefined;

    const loadState = async (): Promise<StudioState | null> => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`state ${res.status}`);
        const s = (await res.json()) as StudioState;
        globalThis.STUDIO_TZ = s.schedule?.timezone ?? globalThis.STUDIO_TZ; // the studio time zone (core/local-config.mjs), for every clock shown
        if (alive) setState(s);
        return s;
      } catch {
        if (alive) setConnected(false);
        return null;
      }
    };

    const soon = () => {
      clearTimeout(refetch);
      refetch = setTimeout(loadState, 250);
    };

    const open = () => {
      if (!alive) return;
      // Without a known starting point the server starts from its newest event, so old history never replays.
      source = new EventSource(lastId === null ? "/api/events" : `/api/events?after=${lastId}`);
      source.onopen = () => setConnected(true);
      source.onmessage = (m) => {
        try {
          const row = JSON.parse(m.data) as EventRow;
          if (typeof row.id !== "number") return;
          lastId = Math.max(lastId ?? 0, row.id);
          pushRef.current([row]);
          soon();
        } catch {
          // A malformed line is ignored; the next state poll still brings the truth.
        }
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        retry = setTimeout(open, RETRY_MS);
      };
    };

    (async () => {
      const s = await loadState();
      // Events already in the database are history: they go in the "Recent work" list, not in the air.
      lastId = typeof s?.last_event_id === "number" ? s.last_event_id : null;
      for (const e of s?.recent ?? []) bus.seen.current.add(e.id);
      open();
    })();
    const poll = setInterval(loadState, STATE_POLL_MS);

    return () => {
      alive = false;
      clearInterval(poll);
      clearTimeout(retry);
      clearTimeout(refetch);
      source?.close();
    };
  }, []);

  const value: LiveSource = { state, events: bus.events, connected, demo: false, onEvent: bus.onEvent };
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** The scripted production day, entirely in memory. Nothing is sent to the server. */
function DemoProvider({ children, speed }: { children: ReactNode; speed: number }) {
  const [state, setState] = useState<StudioState | null>(null);
  const bus = useEventBus();
  const pushRef = useRef(bus.push);
  pushRef.current = bus.push;

  useEffect(() => startDemo({ speed, onState: setState, onEvent: (e) => pushRef.current([e]) }), [speed]);

  const value: LiveSource = { state, events: bus.events, connected: true, demo: true, onEvent: bus.onEvent };
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function LiveProvider({ demo, speed = 1, children }: { demo: boolean; speed?: number; children: ReactNode }) {
  return demo ? <DemoProvider speed={speed}>{children}</DemoProvider> : <ServerProvider>{children}</ServerProvider>;
}

export function useLive(): LiveSource {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used inside <LiveProvider>");
  return ctx;
}
