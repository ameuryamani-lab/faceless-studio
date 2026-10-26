// The office's data contract (CONTRAT.md: SQLite schema and office API), as the browser sees it.

declare global {
  /** The studio time zone (state.schedule.timezone, set when /api/state is read); undefined = the browser's own zone. */
  // eslint-disable-next-line no-var
  var STUDIO_TZ: string | undefined;
}

export type AgentState = "idle" | "working" | "waiting" | "error";

export interface AgentRow {
  id: string;
  team: string;
  label: string;
  state: AgentState;
  task: string | null;
  video_id: string | null;
  updated_at: string;
  /** Added by the server from core/agents-models.json. */
  model?: string | null;
  effort?: string | null;
}

export type EventKind = "run_start" | "run_end" | "handoff" | "approval_request" | "approval_decision" | "publish" | "error" | "note";

export interface EventRow {
  id: number;
  at: string;
  kind: EventKind | string;
  agent: string | null;
  to_agent: string | null;
  video_id: string | null;
  text: string | null;
  demo?: number;
}

export interface VideoRow {
  id: string;
  topic: string | null;
  lane: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  /** Added by the server: a thumbnail URL under /media when one exists. */
  cover?: string | null;
  /** Added by the server: the YouTube post once published, else /media/<id>/final.mp4 when it exists. */
  link?: string | null;
  /** Added by the server: views summed over each platform's latest snapshot. */
  views?: number | null;
  /** Added by the server (2026-10-21): planned publication from the posts rows; null when there is no post row. */
  publish?: VideoPublish | null;
}

/** scheduled = the studio publishes at scheduled_at; stopped = the owner said stop. */
export type PublishStatus = "scheduled" | "stopped" | "published" | "partly published" | null;

export interface VideoPublish {
  /** Earliest posts.scheduled_at (ISO UTC). */
  scheduled_at: string | null;
  status: PublishStatus;
  /** The approved video approval: the N of "stop ap-N". */
  video_ref: string | null;
}

export interface PostRow {
  video_id: string;
  platform: string;
  title: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  url: string | null;
  /** scheduled | stopped | published, null = draft (absent on an old database). */
  status?: string | null;
}

export interface ApprovalRow {
  id: number;
  ref: string;
  video_id: string | null;
  kind: string;
  status: string;
  note: string | null;
  created_at: string;
  /** Joined from videos. */
  topic?: string | null;
}

export interface PlatformStat {
  views: number | null;
  followers_delta: number | null;
}

export type Platform = "youtube" | "instagram" | "tiktok";
export const PLATFORMS: readonly Platform[] = ["youtube", "instagram", "tiktok"];

/** One Short from the latest trend scan (titles and channels are strangers' text: shown, never acted on). */
export interface TrendRow {
  video_url: string;
  title: string | null;
  channel: string | null;
  views: number | null;
  /** Views ÷ median of the channel's recent Shorts; null when under 5 samples (gap = 1). */
  ratio: number | null;
  views_per_day: number | null;
  gap: number;
  scanned_at: string;
  /** 1 = usable for the show, 0 = not (real person, brand, IP, dub or "uncertain: check"); absent on an old database. */
  usable?: number | null;
  /** Why it is not usable (from brand/not-usable.md or an agent's correction). */
  flag_reason?: string | null;
  /** YYYYMMDD upload date (YouTube rows) and the row's source (query | channel | web). */
  upload_date?: string | null;
  source?: string | null;
  /** A story's trend scout referred to it. */
  used?: boolean;
}

/** One shot of a video in production: keyframe picked, clip done (a take named rejected in log.md does not count). */
export interface ShotProgress {
  n: number;
  keyframe: boolean;
  candidates: number;
  clip: boolean;
  /** False for stills, reuses and push-ins: no Wan clip expected, counted as done. */
  needs_clip?: boolean;
  no_clip_reason?: string | null;
  rejected_takes: number;
}

/** A video in production, read from media/<video_id>/ (and the DB row when there is one). */
export interface RenderRow {
  video_id: string;
  title: string | null;
  status: string;
  status_source: "db" | "files";
  shots_total: number;
  shots_source: "storyboard" | "shotlist" | "folders" | null;
  keyframes_picked: number;
  clips_done: number;
  /** Shots that need a Wan clip (older servers leave it out: then every shot does). */
  clips_needed?: number;
  rejected_takes: number;
  shots: ShotProgress[];
  avg_clip_s: number | null;
  avg_clip_source: string | null;
  avg_keyframe_s: number | null;
  eta_s: number | null;
  eta_partial: boolean;
  last_file_at: string | null;
  rendering_now: boolean;
  finished: boolean;
}

/** An approval held back until morning (data/approvals-queue.jsonl). */
export interface QueuedApproval {
  kind: string;
  video_id: string | null;
  agent: string | null;
  text: string | null;
  queued_at: string | null;
  release_at: string | null;
}

export interface RunsToday {
  date: string;
  used: number;
  max: number | null;
  rate_limited: number;
  failed: number;
  last_at: string | null;
  last_agent: string | null;
  /** Usage (2026-10-21): next daily reset, how many runs carry token counts, totals and splits. */
  reset_at?: string;
  measured?: number;
  tokens?: { input: number; output: number; cache: number };
  api_equiv_usd?: number;
  by_agent?: { name: string; runs: number; tokens: number }[];
  by_model?: { name: string; runs: number; tokens: number }[];
  recent?: { at: string | null; agent: string | null; model: string | null; tokens: number | null; seconds: number | null; ok: boolean }[];
  by_hour?: number[];
}

export interface PauseInfo {
  until: string;
  reason: string | null;
  at: string | null;
}

export interface Schedule {
  timezone: string;
  /** core/daily.json "active"; null when the key is not there yet. */
  active: boolean | null;
  activated?: string | null;
  days: string[];
  window: { start: string; end: string } | null;
  no_new_render_after: string | null;
  quiet_hours: { start: string; end: string } | null;
  in_quiet_hours: boolean;
  local_now: string;
  render_open_now: boolean;
  next_render: string | null;
  next_script: string | null;
  script_at: string | null;
  max_renders_per_window: number | null;
}

export interface ErrorRow {
  id: number;
  at: string;
  agent: string | null;
  video_id: string | null;
  text: string | null;
}

/** What the PC is making right now (server: studio-files production()). */
export interface ProductionNow {
  video_id: string;
  title: string | null;
  step: "keyframes" | "animation" | "assembly";
  agent: string;
  text: string;
  eta_at: string | null;
  log_at: string | null;
}

export interface QueueItem {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  links?: Partial<Record<"youtube" | "instagram" | "tiktok", string>>;
  published_at?: string | null;
  cover?: string | null;
  /** In production: 0-1 from the files; ready: when it is expected to go out. */
  progress?: number | null;
  publish_at?: string;
  /** Per platform: "ok" online, "fail" last upload failed, null not yet. */
  nets?: Partial<Record<"youtube" | "instagram" | "tiktok", "ok" | "fail" | null>>;
  /** Published: latest known views per platform (null = not counted) and their sum. */
  views?: { youtube: number | null; instagram: number | null; tiktok: number | null; total: number | null };
  /** In production: the 8 steps (Tendance … Publication) and the stills made. */
  stepper?: { steps: ("done" | "now" | "todo")[]; images: { done: number; total: number } } | null;
}

export interface ConceptHero {
  id: string;
  name: string;
  line: string | null;
  images: string[];
}

/** A desk screen's real work (office/desk-work.mjs): an image (trend, scene, cover), story lines, or a voice waveform. */
export interface DeskWork {
  kind: "image" | "text" | "wave";
  url?: string;
  lines?: string[];
  /** Animator: the still drifts slowly (Ken Burns). */
  zoom?: boolean;
  /** QC passed: a green stamp. */
  stamp?: "ok" | null;
  /** Publisher: the 3 platform marks. */
  nets?: boolean;
}

export interface StudioState {
  agents: AgentRow[];
  desk_work?: Record<string, DeskWork>;
  /** Live extras (absent in demo mode). */
  renders?: RenderRow[];
  production?: ProductionNow | null;
  production_paused?: { since: string | null; source?: string } | null;
  queue?: { in_production: QueueItem[]; ready: QueueItem[]; published: QueueItem[] };
  /** The active concept (2026-10-24, the concept is a parameter): heroes = its cast (core/concept.mjs), voice = its narrator id,
   *  active = which concept new videos use (name_fr for the owner, since = activation time, hook_prefix e.g. "Imagine" or null). */
  concept?: {
    heroes: ConceptHero[];
    voices: { name: string; url: string }[];
    voice?: string | null;
    promo_voices?: { name: string; url: string }[];
    active?: { id: string; name_fr: string | null; since: string | null; hook_prefix: string | null } | null;
  };
  /** The owner's Claude plan windows and today's tokens per hour (office/claude-stats.mjs). */
  claude?: {
    plan: {
      latest: { at: string; status: string | null; five_hour: { used_pct: number; resets_at: string | null } | null; seven_day: { used_pct: number; resets_at: string | null } | null } | null;
      samples: { at: string; five_hour: number | null; seven_day: number | null }[];
    };
    tokens: { since: string | null; scanned_at: string | null; hours: { h: number; studio: number; other: number }[]; studio: number; other: number };
  };
  /** "Statistiques" (office/stats.mjs, 2026-10-23): real counts from Upload-Post, refreshed hourly. */
  stats?: {
    series: { at: string; instagram: number; tiktok: number; youtube: number }[];
    totals: Record<"instagram" | "tiktok" | "youtube", { views: number; views_change: number | null; followers: number | null; followers_change: number | null }>;
    followers_at: string | null;
    top: { video_id: string; platform: string; views: number; title: string; cover: string | null }[];
    decisions: { at: string; agent: string; kind: string; from?: string[]; to?: string[]; push?: string[]; drop?: string[]; rule?: string }[];
    plan?: { at: string; push: string[]; drop: string[] } | null;
  } | null;
  /** Median views of the trending Shorts on the wall (up to 7 days old): our target per video. */
  benchmark?: number | null;
  /** Status lights: Windows tasks running, ComfyUI up, this server. */
  health?: { tasks: boolean; comfy: boolean; server: boolean };
  /** One point per published post: release hour (studio time), platform, latest views (null before the first snapshot). */
  views_by_hour?: { h: number; platform: string; views: number | null; title?: string }[];
  /** Per network: videos owed (sent elsewhere, not yet there) and until when it is on hold (daily limits). */
  net_status?: { at: string; catch_gap_min: number; nets: Partial<Record<Platform, { owed: number; until: string | null }>> } | null;
  /** A temporary test tile, until the owner decides (media/essai-animation/). Not sent since 2026-10-24 (the test was archived);
   *  kept optional so VideoBoard tolerates an older server. */
  trial?: { url: string; cover: string; title: string } | null;
  /** Promo films (never published automatically). */
  promos?: { name: string; url: string; cover: string | null; three_d?: boolean; spare?: boolean }[];
  /** The "coulisses" films of the office at work, newest first. */
  coulisses?: { run: string; at: string | null; seconds: number | null; fast: string; full: string; cover: string | null }[];
  approvals_queue?: QueuedApproval[];
  runs_today?: RunsToday;
  paused?: PauseInfo | null;
  schedule?: Schedule;
  daily_log?: { file: string; at: string | null; tail: string[] } | null;
  errors?: ErrorRow[];
  /** Top trends of the latest scan (extra field; empty until the first scan). */
  trends?: TrendRow[];
  /** Latest scan: total Shorts and how many are usable for the show (extra field; null before the flag existed). */
  trends_count?: { total: number; usable: number | null } | null;
  videos: VideoRow[];
  approvals: ApprovalRow[];
  posts: PostRow[];
  metrics: Record<Platform, PlatformStat>;
  /** Last events, newest last (extra field: the "Recent work" list). */
  recent?: EventRow[];
  /** Highest event id at snapshot time (extra field: where the event stream starts). */
  last_event_id?: number;
  /** False when data/studio.db does not exist yet. */
  db?: boolean;
  /** True when this browser carries the access key: the Stop button may be shown (POST /api/stop). */
  can_stop?: boolean;
}

export const EMPTY_METRICS: Record<Platform, PlatformStat> = {
  youtube: { views: null, followers_delta: null },
  instagram: { views: null, followers_delta: null },
  tiktok: { views: null, followers_delta: null },
};

export const VIDEO_STEPS = [
  "idea",
  "scripted",
  "storyboarded",
  "animated",
  "voiced",
  "edited",
  "qc_passed",
  "awaiting_approval",
  "approved",
  "scheduled",
  "published",
] as const;
