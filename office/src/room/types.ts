// Adapted from AttentionOS (MIT licence, Copyright (c) 2026 The AttentionOS Authors), commit 89f6781,
// apps/studio/src/components/worker-room/types.ts. See licences/ATTENTIONOS-LICENSE. Changes for Faceless Studio.
import type { RobotId, TeamId } from "./cast";
import type { Place } from "./layout";

/** How a pad, desk or the chief reads in the room. "blocked" is an agent in the error state. */
export type RoomState = "working" | "waiting" | "idle" | "paused" | "blocked";

/** How one desk looks right now. Only "work" and "send" animate, and only while the real agent is working. */
export type DeskStatus = "work" | "send" | "wait" | "block" | "idle";

export interface DeskLive {
  status: DeskStatus;
  /** Bumps each time the desk screen should replay its story. */
  cycle: number;
  /** Where the robot is handing work, while status is "send". */
  to: Place | null;
}

export interface TeamLive {
  team: TeamId;
  state: RoomState;
  /** The team's name. */
  name: string;
  /** What the working agent is doing right now. */
  label: string;
  pending: number;
}

export type FlightKind = "job" | "pass" | "done" | "post" | "comment" | "read" | "scan";

export interface Flight {
  id: string;
  kind: FlightKind;
  from: Place;
  to: Place;
  /** performance.now() when it took off. */
  start: number;
  dur: number;
  tint: string;
  /** Text on a job ticket. */
  label?: string;
  /** Which wall phone a feed flight uses. */
  phone?: number;
}

export interface FeedCard {
  id: string;
  /** Image URL (a thumbnail under /media, or a generic data: cover). Null draws a blank phone. */
  cover: string | null;
  views: number | null;
  title: string;
  platform: string;
  /** Trending wall: views ÷ the channel's median ("9.1×"), when known. */
  ratio?: number | null;
  /** Hover text (e.g. the channel name). */
  detail?: string;
  /** Trending wall: flagged "not usable" for the show (shown with a badge, never hidden). */
  notUsable?: boolean;
  /** Our channel: "EN LIGNE", "PRÊTE" or "EN FABRICATION"; trending: "✓ UTILISÉE" when we made a video from it. */
  badge?: string;
  /** Tap target: the YouTube post, our own final.mp4, or the trend's source. */
  href?: string | null;
  /** Trending wall: age of the upload ("3 j"). */
  age?: string;
}

export interface WallFeedData {
  /** Left wall: our channel. */
  cards: FeedCard[];
  /** Right wall: trending. */
  trending: FeedCard[];
  totalViews: number;
  totalPosts: number;
  /** Trending wall: Shorts of the latest scan usable for the show, and the scan's total (live mode, when known). */
  trendUsable?: number | null;
  trendTotal?: number | null;
}

export type Desks = Record<RobotId, DeskLive>;
