// Adapted from AttentionOS (MIT licence, Copyright (c) 2026 The AttentionOS Authors), commit 89f6781,
// apps/studio/src/components/worker-room/layout.ts. See licences/ATTENTIONOS-LICENSE. Changes for Faceless Studio:
// 7 team pads instead of 6. The room is laid out symmetrically around the x = y diagonal: two pads on the back right
// wall, one on the right side, one in the front corner, one on the front side and two on the left wall (the server
// racks are gone to make room). Where everything stands, in floor tiles. The back corner (0, 0) is at the top center.

import { TEAMS, type RobotId, type TeamId } from "./cast";
import { bounds, iso, type Pt } from "./iso";

export const W = 34;
export const D = 34;
export const H = 9.1;
export const SLAB = 0.6;

/** Row direction. "x" rows run to the lower right, "y" rows run to the lower left. */
export type Orient = "x" | "y";

export const DESK = { half: 1.15, depth: 0.5, top: 0.82 };
export const SEAT = { back: 1.15, z: 0.45 };
export const SCREEN = { back: 2.0, half: 1.3, z0: 2.3, z1: 3.94 };
export const ROBOT_SCALE = 1.5;
export const CHIEF_SCALE = 2.3;

export interface Spot {
  id: RobotId;
  team: TeamId;
  cx: number;
  cy: number;
  orient: Orient;
}

interface Row {
  orient: Orient;
  /** Desk centers, in the same order as the team's robots. */
  at: readonly (readonly [number, number])[];
  pad: readonly (readonly [number, number])[];
  /** Where the floor label starts, and which way it reads. "front" faces the viewer square on. */
  label: { x: number; y: number; along: Orient | "front" };
  /** Floor line from the brain to this pad, as tile points. */
  link: readonly (readonly [number, number])[];
}

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export const CHIEF = { x: 5.9, y: 5.9, z: 0.5, dais: [2.5, 8.7] as const, inner: [2.95, 8.25] as const };
export const CORE = { x: 17, y: 17 };

export const ROWS: Record<TeamId, Row> = {
  research: {
    orient: "x",
    at: [[11.3, 5.7], [14.8, 5.7], [18.3, 5.7]],
    pad: rect(9.4, 3.1, 20.2, 7.6),
    label: { x: 9.8, y: 7.25, along: "x" },
    link: [[CORE.x, CORE.y - 1.3], [CORE.x, 11], [14.8, 11], [14.8, 7.7]],
  },
  strategy: {
    orient: "x",
    at: [[24.3, 5.7], [27.8, 5.7], [31.3, 5.7]],
    pad: rect(22.4, 3.1, 33.2, 7.6),
    label: { x: 22.8, y: 7.25, along: "x" },
    link: [[CORE.x + 0.9, CORE.y - 0.9], [24.3, 10.6], [24.3, 7.7]],
  },
  writing: {
    orient: "y",
    at: [[29.4, 12.2], [29.4, 15.7], [29.4, 19.2]],
    pad: rect(26.8, 10.3, 31.3, 21.1),
    label: { x: 30.95, y: 20.7, along: "y" },
    link: [[CORE.x + 1.3, CORE.y], [23, CORE.y], [23, 15.7], [26.7, 15.7]],
  },
  character: {
    orient: "x",
    at: [[31.9, 26.9], [29.3, 29.5], [26.7, 32.1]],
    pad: [[24.8, 29.6], [30.0, 24.4], [33.75, 24.4], [33.75, 27.9], [28.5, 33.15], [24.8, 33.15]],
    label: { x: 28.9, y: 32.35, along: "front" },
    link: [[CORE.x + 1, CORE.y + 1], [27.1, 27.1]],
  },
  visual: {
    orient: "x",
    at: [[19.2, 29.4], [15.7, 29.4], [12.2, 29.4]],
    pad: rect(10.3, 26.8, 21.1, 31.3),
    label: { x: 10.7, y: 30.95, along: "x" },
    link: [[CORE.x, CORE.y + 1.3], [CORE.x, 23], [15.7, 23], [15.7, 26.7]],
  },
  sound_edit: {
    orient: "y",
    at: [[5.7, 31.3], [5.7, 27.8], [5.7, 24.3]],
    pad: rect(3.1, 22.4, 7.6, 33.2),
    label: { x: 7.25, y: 32.8, along: "y" },
    link: [[CORE.x - 0.9, CORE.y + 0.9], [10.6, 24.3], [7.7, 24.3]],
  },
  distribution: {
    orient: "y",
    at: [[5.7, 18.3], [5.7, 14.8], [5.7, 11.3]],
    pad: rect(3.1, 9.4, 7.6, 20.2),
    label: { x: 7.25, y: 19.8, along: "y" },
    link: [[CORE.x - 1.3, CORE.y], [11, CORE.y], [11, 14.8], [7.7, 14.8]],
  },
};

export const CHIEF_LINK: readonly (readonly [number, number])[] = [[CORE.x - 1, CORE.y - 1], [CHIEF.dais[1] + 0.1, CHIEF.dais[1] + 0.1]];

export const SPOTS: Record<RobotId, Spot> = Object.fromEntries(
  TEAMS.flatMap((t) => t.robots.map((id, i) => [id, { id, team: t.id, cx: ROWS[t.id].at[i]![0], cy: ROWS[t.id].at[i]![1], orient: ROWS[t.id].orient }])),
) as Record<RobotId, Spot>;

/** Station coordinates to world. a runs along the row, b runs front (+) to back (-). */
export function world(s: Pick<Spot, "cx" | "cy" | "orient">, a: number, b: number): [number, number] {
  return s.orient === "x" ? [s.cx + a, s.cy + b] : [s.cx + b, s.cy + a];
}

/** Phones on the two back walls. */
export const WALL_PHONES = 7;
export const PHONE = { w: 3.2, gap: 0.8, first: 3.9, z0: 3.3, z1: 8.23 };
export const phoneStart = (k: number): number => PHONE.first + k * (PHONE.w + PHONE.gap);

export type Place = RobotId | "chief" | "core" | "wallL" | "wallR";

export function headPoint(id: RobotId): Pt {
  const s = SPOTS[id];
  const [x, y] = world(s, 0, -SEAT.back);
  return iso(x, y, 3.25);
}

/** Where a packet starts or lands. `phone` picks the wall phone. */
export function anchor(place: Place, phone = 0): Pt {
  const k = ((phone % WALL_PHONES) + WALL_PHONES) % WALL_PHONES;
  const mid = (PHONE.z0 + PHONE.z1) / 2;
  if (place === "chief") return iso(CHIEF.x + 1.5, CHIEF.y + 1.5, CHIEF.z + 1.9);
  if (place === "core") return iso(CORE.x, CORE.y, 5);
  if (place === "wallL") return iso(0, phoneStart(k) + PHONE.w / 2, mid);
  if (place === "wallR") return iso(phoneStart(k) + PHONE.w / 2, 0, mid);
  return headPoint(place);
}

/** The SVG viewBox for the whole room. */
export const VIEW = (() => {
  const left = iso(0, D)[0] - 18;
  const right = iso(W, 0)[0] + 18;
  const top = iso(0, 0, H)[1] - 16;
  const bottom = iso(W, D, -SLAB)[1] + 14;
  return { x: left, y: top, w: right - left, h: bottom - top };
})();

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a team's live status tag floats: above the middle screen. */
export function tagPoint(team: TeamId): Pt {
  const row = ROWS[team];
  const [cx, cy] = row.at[1]!;
  const [x, y] = world({ cx, cy, orient: row.orient }, 0, -SCREEN.back);
  return iso(x, y, SCREEN.z1 + 1.15);
}

function rowRect(team: TeamId, extra: readonly Pt[] = []): Rect {
  const row = ROWS[team];
  const floor = row.pad.map(([x, y]) => iso(x, y, 0));
  const tops = row.at.flatMap(([cx, cy]) => {
    const s = { cx, cy, orient: row.orient };
    return [-SCREEN.half, SCREEN.half].map((a) => iso(...world(s, a, -SCREEN.back), SCREEN.z1));
  });
  const [tx, ty] = tagPoint(team);
  return bounds([...floor, ...tops, [tx, ty - 22], ...extra], 16);
}

export type StopId = "room" | "chief" | "brain" | TeamId | "feed" | "trending";

/** On a tall phone screen the wide shot trims the two empty side corners so the teams read larger. */
export const ROOM_TALL: Rect = { x: -765, y: VIEW.y, w: 1530, h: VIEW.h };

export const FRAMES: Record<StopId, Rect> = {
  room: VIEW,
  chief: bounds([iso(CHIEF.dais[0], CHIEF.dais[1]), iso(CHIEF.dais[1], CHIEF.dais[0]), iso(CHIEF.dais[1], CHIEF.dais[1]), iso(0, 0, H - 1.2)], 26),
  brain: bounds([iso(CORE.x - 4.4, CORE.y + 4.4), iso(CORE.x + 4.4, CORE.y - 4.4), iso(CORE.x + 3.4, CORE.y + 3.4), iso(CORE.x, CORE.y, 6.6)], 10),
  research: rowRect("research", [iso(10, 0, PHONE.z0 + 2.2)]),
  strategy: rowRect("strategy"),
  writing: rowRect("writing"),
  character: rowRect("character"),
  visual: rowRect("visual"),
  sound_edit: rowRect("sound_edit", [iso(0, 27, PHONE.z0 + 3)]),
  distribution: rowRect("distribution", [iso(0, 11.5, PHONE.z0 + 3)]),
  feed: bounds([iso(0, phoneStart(0) - 0.4, H), iso(0, phoneStart(WALL_PHONES - 1) + PHONE.w + 0.4, H), iso(0, phoneStart(WALL_PHONES - 1) + PHONE.w + 0.4, PHONE.z0 - 0.5), iso(0, phoneStart(0) - 0.4, PHONE.z0 - 0.5)], 8),
  // The trending wall is the other back wall (y = 0), its phones along x (so the camera can zoom on it).
  trending: bounds([iso(phoneStart(0) - 0.4, 0, H), iso(phoneStart(WALL_PHONES - 1) + PHONE.w + 0.4, 0, H), iso(phoneStart(WALL_PHONES - 1) + PHONE.w + 0.4, 0, PHONE.z0 - 0.5), iso(phoneStart(0) - 0.4, 0, PHONE.z0 - 0.5)], 8),
};
