// Demo mode (/?demo=1): one production day, replayed in the browser. Nothing here touches the server or the
// database. Every row is marked demo = 1, the channel stays generic ("Our channel") and no real name or handle
// appears. The day runs research → strategy → writing → character → visual → sound & edit → the Chief asks for
// approval → distribution, then starts again with the next topic.

import { agentName, CHIEF_ID, TEAMS } from "../room/cast";
import { makeCover } from "./covers";
import type { AgentRow, AgentState, ApprovalRow, EventRow, Platform, PostRow, StudioState, VideoRow } from "./types";

const TASKS: Record<string, string> = {
  outlier_analyst: "Scoring 40 Shorts for outliers",
  trend_scout: "Scanning today's trends",
  teardown_analyst: "Taking apart the top Short",
  strategist: "Picking the angle",
  calendar_planner: "Booking Thursday's slot",
  topic_editor: "Locking the topic",
  copywriter: "Writing a 45-second script",
  hook_auditor: "Testing 5 hooks",
  fact_checker: "Checking 6 facts",
  character_keeper: "Matching the character bible",
  voice_writer: "Writing lines in character",
  continuity_checker: "Checking outfit and props",
  storyboard_artist: "Drawing 8 frames",
  image_artist: "Painting frame 3 of 8",
  animator: "Animating 8 shots",
  voice_director: "Recording the voice",
  editor: "Cutting to 45 seconds",
  qc_inspector: "Running 12 checks",
  publisher: "Posting to 3 platforms",
  results_analyst: "Reading the first hour",
  postmortem_writer: "Writing what we learned",
};

/** The video status reached when this agent finishes. */
const STATUS_AFTER: Record<string, string> = {
  topic_editor: "idea",
  fact_checker: "scripted",
  storyboard_artist: "storyboarded",
  animator: "animated",
  voice_director: "voiced",
  editor: "edited",
  qc_inspector: "qc_passed",
};

const TOPICS = [
  { topic: "Why the octopus has three hearts", lane: "Nature" },
  { topic: "The coin that changed Rome", lane: "History" },
  { topic: "How a seed knows which way is up", lane: "Science" },
  { topic: "The bridge that sang in the wind", lane: "Engineering" },
] as const;

const OLD_TITLES = ["The lost city under the sand", "Why cats always land on their feet", "A day inside a beehive", "The tallest wave ever surfed", "How ice keeps fish alive", "The map that lied", "Why the sky turns red"];
const TREND_TITLES = ["Tiny animal facts", "History in 30 seconds", "Space myths, busted", "Ancient tech", "Ocean mysteries", "Weird physics", "Food origins"];

const WORK_MS = 4000;
const GAP_MS = 400;
const APPROVAL_WAIT_MS = 6500;
const RESTART_MS = 6000;

export interface DemoFeed {
  cards: { id: string; title: string; cover: string; views: number }[];
  trending: { id: string; title: string; cover: string; views: number }[];
}

/** Extra demo data for the walls, read by the room (never sent anywhere). */
export const DEMO_FEED: DemoFeed = {
  cards: OLD_TITLES.map((title, i) => ({ id: `demo-old-${i}`, title, cover: makeCover(i), views: [48200, 12900, 7300, 25400, 3100, 9800, 15600][i]! })),
  trending: TREND_TITLES.map((title, i) => ({ id: `demo-trend-${i}`, title, cover: makeCover(i + 3, true), views: [1_200_000, 840_000, 2_300_000, 510_000, 960_000, 1_700_000, 430_000][i]! })),
};

interface Ctx {
  speed: number;
  onState: (s: StudioState) => void;
  onEvent: (e: EventRow) => void;
}

const now = () => new Date().toISOString();

export function startDemo({ speed, onState, onEvent }: Ctx): () => void {
  const k = speed > 0 ? speed : 1;
  let seq = 0;
  let round = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const agentRows = (): AgentRow[] => [
    { id: CHIEF_ID, team: "chief", label: "Chief of Staff", state: "idle", task: null, video_id: null, updated_at: now() },
    ...TEAMS.flatMap((t) => t.robots.map((id) => ({ id, team: t.id, label: agentName(id), state: "idle" as AgentState, task: null, video_id: null, updated_at: now() }))),
  ];

  let state: StudioState = {
    agents: agentRows(),
    videos: [],
    approvals: [],
    posts: [],
    metrics: {
      youtube: { views: 121_400, followers_delta: 64 },
      instagram: { views: 58_900, followers_delta: 31 },
      tiktok: { views: 203_700, followers_delta: 118 },
    },
    recent: [],
    last_event_id: 0,
    db: true,
  };

  const commit = (next: Partial<StudioState>) => {
    state = { ...state, ...next };
    onState(state);
  };

  const emit = (kind: string, agent: string | null, to: string | null, text: string, video: string | null) => {
    const e: EventRow = { id: ++seq, at: now(), kind, agent, to_agent: to, video_id: video, text, demo: 1 };
    commit({ recent: [...(state.recent ?? []), e].slice(-20), last_event_id: e.id });
    onEvent(e);
  };

  const setAgent = (id: string, st: AgentState, task: string | null, video: string | null) =>
    commit({ agents: state.agents.map((a) => (a.id === id ? { ...a, state: st, task, video_id: video, updated_at: now() } : a)) });

  const setVideo = (id: string, patch: Partial<VideoRow>) =>
    commit({ videos: state.videos.map((v) => (v.id === id ? { ...v, ...patch, updated_at: now() } : v)) });

  const bumpStats = (gain: number) => {
    const m = { ...state.metrics };
    (Object.keys(m) as Platform[]).forEach((p, i) => {
      const cur = m[p];
      m[p] = { views: (cur.views ?? 0) + gain * (i + 1), followers_delta: (cur.followers_delta ?? 0) + Math.round(gain / 120) + i * 3 };
    });
    commit({ metrics: m });
  };

  const day = () => {
    timers = [];
    const pick = TOPICS[round % TOPICS.length]!;
    const vid = `v-demo-${String(round + 1).padStart(2, "0")}`;
    const ref = `ap-${round + 1}`;
    round++;
    let t = 600;
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms / k));

    at(t, () => {
      setAgent(CHIEF_ID, "working", "Planning today's video", null);
      emit("run_start", CHIEF_ID, null, "Planning today's video", null);
    });
    t += 2200;
    at(t, () => emit("handoff", CHIEF_ID, "outlier_analyst", "Find what is working this week", null));
    t += 1200;

    const chain = TEAMS.filter((tm) => tm.id !== "distribution").flatMap((tm) => tm.robots as readonly string[]);
    chain.forEach((agent, i) => {
      const startAt = t;
      at(startAt, () => {
        if (agent === "strategist") {
          commit({ videos: [{ id: vid, topic: pick.topic, lane: pick.lane, status: "idea", created_at: now(), updated_at: now(), cover: makeCover(round + 11), views: null }, ...state.videos].slice(0, 10) });
        }
        const video = i >= 3 ? vid : null;
        setAgent(agent, "working", TASKS[agent] ?? "Working", video);
        emit("run_start", agent, null, TASKS[agent] ?? "Working", video);
      });
      t += WORK_MS;
      at(t, () => {
        const video = i >= 3 ? vid : null;
        setAgent(agent, "idle", null, null);
        emit("run_end", agent, null, "Done", video);
        const status = STATUS_AFTER[agent];
        if (status && i >= 3) setVideo(vid, { status });
        const next = chain[i + 1] ?? CHIEF_ID;
        emit("handoff", agent, next, next === CHIEF_ID ? "Video ready for the Chief" : `Passing it to the next desk`, video);
      });
      t += GAP_MS;
    });

    at(t + 600, () => {
      setVideo(vid, { status: "awaiting_approval" });
      commit({ approvals: [...state.approvals, { id: round, ref, video_id: vid, kind: "video", status: "pending", note: null, created_at: now(), topic: pick.topic } as ApprovalRow] });
      setAgent(CHIEF_ID, "waiting", `Waiting for your yes on ${ref}`, vid);
      emit("approval_request", "qc_inspector", CHIEF_ID, `${ref}: ${pick.topic}`, vid);
    });
    t += 600 + APPROVAL_WAIT_MS;

    at(t, () => {
      commit({ approvals: state.approvals.filter((a) => a.ref !== ref) });
      setVideo(vid, { status: "approved" });
      setAgent(CHIEF_ID, "working", "Sending it to Distribution", vid);
      emit("approval_decision", CHIEF_ID, null, `${ref} approved (demo)`, vid);
    });
    t += 1200;
    at(t, () => emit("handoff", CHIEF_ID, "publisher", "Approved: schedule it", vid));
    t += 900;

    const dist = TEAMS.find((tm) => tm.id === "distribution")!.robots;
    dist.forEach((agent, i) => {
      at(t, () => {
        if (i === 0) setAgent(CHIEF_ID, "idle", null, null);
        setAgent(agent, "working", TASKS[agent] ?? "Working", vid);
        emit("run_start", agent, null, TASKS[agent] ?? "Working", vid);
        if (i === 0) setVideo(vid, { status: "scheduled" });
      });
      t += WORK_MS;
      at(t, () => {
        if (i === 0) {
          setVideo(vid, { status: "published", views: 0 });
          const posts: PostRow[] = (["youtube", "instagram", "tiktok"] as const).map((p) => ({ video_id: vid, platform: p, title: pick.topic, scheduled_at: now(), published_at: now(), url: null }));
          commit({ posts: [...posts, ...state.posts].slice(0, 10) });
          emit("publish", agent, null, "Published to YouTube, Instagram and TikTok (demo)", vid);
        }
        if (i === 1) bumpStats(900);
        setAgent(agent, "idle", null, null);
        emit("run_end", agent, null, "Done", vid);
        if (dist[i + 1]) emit("handoff", agent, dist[i + 1]!, "Here are the numbers", vid);
      });
      t += GAP_MS;
    });

    at(t + 800, () => setVideo(vid, { views: 1800 + round * 700 }));
    at(t + RESTART_MS, day);
  };

  onState(state);
  day();
  return () => {
    for (const id of timers) clearTimeout(id);
    timers = [];
  };
}
