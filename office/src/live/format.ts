// Plain-English formatting for the side panel. relTime and compact follow AttentionOS
// apps/studio/src/components/shell/format.ts (MIT licence, Copyright (c) 2026 The AttentionOS Authors).

import { agentName } from "../room/cast";
import type { EventRow } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "12 min ago", "3 h ago", "yesterday", "Oct 4". */
export function relTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const abs = Math.abs(now - t);
  const future = now - t < 0;
  if (abs < 45_000) return "just now";
  if (abs < HOUR) {
    const m = Math.max(1, Math.round(abs / MIN));
    return future ? `in ${m} min` : `${m} min ago`;
  }
  if (abs < DAY) {
    const h = Math.round(abs / HOUR);
    return future ? `in ${h} h` : `${h} h ago`;
  }
  if (!future && abs < 2 * DAY) return "yesterday";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** 1234 → "1.2k". Null stays "—": an empty stat is never shown as zero. */
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 10_000) return `${Math.round(n / 1000)}k`;
  if (a >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

export function signed(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n > 0 ? `+${compact(n)}` : compact(n);
}

export const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };

export function statusLabel(s: string): string {
  if (s === "qc_passed") return "QC passed";
  if (s === "awaiting_approval") return "Awaiting approval";
  return s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function quoted(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  return t ? `: ${t.length > 70 ? `${t.slice(0, 69)}…` : t}` : "";
}

/** One event as a short sentence. */
export function describeEvent(e: EventRow): string {
  const who = agentName(e.agent);
  switch (e.kind) {
    case "run_start":
      return `${who} started${quoted(e.text)}`;
    case "run_end":
      return e.text && e.text !== "Done" ? `${who} finished${quoted(e.text)}` : `${who} finished`;
    case "handoff":
      return `${who} handed off to ${agentName(e.to_agent)}`;
    case "approval_request":
      return `Approval requested${quoted(e.text)}`;
    case "approval_decision":
      return `Decision${quoted(e.text)}`;
    case "publish":
      return `Published${quoted(e.text)}`;
    case "error":
      return `${who} hit a problem${quoted(e.text)}`;
    default:
      return `${who}${quoted(e.text) || " left a note"}`;
  }
}

/** "07:00" today, "Wed 07:00" another day, in the studio's time zone. */
export function clockIn(iso: string | null | undefined, tz: string, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  try {
    const day = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
    if (day(t) === day(now)) return time;
    if (day(t) === day(now + DAY)) return `tomorrow ${time}`;
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(t)} ${time}`;
  } catch {
    return new Date(t).toISOString().slice(11, 16);
  }
}

/** 1609 → "27 min", 5400 → "1 h 30". */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  if (seconds < 60) return "under a minute";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, "0")}` : `${h} h`;
}
