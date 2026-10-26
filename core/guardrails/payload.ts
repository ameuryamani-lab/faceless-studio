// Ported from AttentionOS by Evan Baker (MIT), commit 89f67813, packages/guardrails/src/payload.ts. See licences/NOTICE.
// Faceless Studio adaptation: local types (no @attentionos/core), only youtube / instagram / tiktok, no trial reels,
// collaborators or first comments. Validates a publish payload BEFORE any API call; this file never publishes anything.
import { checkPlatformLimits, type CaptionPlatform } from "./captions.ts";
import { IssueCollector, type ValidationResult } from "./issues.ts";

export type MediaRef = { kind: "video" | "image"; url?: string; localPath?: string; mimeType?: string; durationS?: number };
export type PublishRequest = {
  platform: CaptionPlatform;
  idempotencyKey: string;
  title?: string; // youtube
  caption?: string;
  hashtags?: string[];
  media: MediaRef[];
  scheduledAt?: string;
  /** AI-generated content label (contract: ai_label defaults to 1). */
  aiGenerated?: boolean;
  tiktokPrivacy?: "public" | "friends" | "private";
  youtubeMadeForKids?: boolean;
  /** Approval ref (ap-N) that the owner approved. Required: nothing goes out without it. */
  approvalRef?: string;
};

export type PayloadOptions = { now?: Date; minLeadMs?: number; approvedRefs?: ReadonlySet<string> };

/** Vertical short-form rules (seconds). YouTube Shorts up to 180 s; the studio itself caps at 60 s in QC. */
export const MEDIA_RULES: Record<CaptionPlatform, { minVideoS: number; maxVideoS: number }> = {
  youtube: { minVideoS: 1, maxVideoS: 180 },
  instagram: { minVideoS: 3, maxVideoS: 900 },
  tiktok: { minVideoS: 3, maxVideoS: 600 },
};

const VIDEO_MIME = /^video\/(mp4|quicktime)$/;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;

export function validatePublishPayload(req: PublishRequest, opts: PayloadOptions = {}): ValidationResult {
  const c = new IssueCollector();
  const p = req.platform;

  if (!req.approvalRef || !/^ap-\d+$/.test(req.approvalRef)) {
    c.error("payload.no_approval", "The payload has no approval ref; nothing is published without the owner's yes.", { path: "approvalRef", fix: "Request approval and wait for the owner's decision." });
  } else if (opts.approvedRefs && !opts.approvedRefs.has(req.approvalRef)) {
    c.error("payload.approval_not_approved", `${req.approvalRef} is not approved.`, { path: "approvalRef", fix: "Wait for the owner to approve it." });
  }

  if (!req.idempotencyKey || !req.idempotencyKey.trim()) {
    c.error("payload.idempotency_missing", "The payload has no idempotency key, so a retry could post twice.", { path: "idempotencyKey", fix: "Use <video id>:<platform>:<version>." });
  } else if (!IDEMPOTENCY_KEY_RE.test(req.idempotencyKey)) {
    c.error("payload.idempotency_format", `Idempotency key "${req.idempotencyKey.slice(0, 40)}" must be 8 to 200 characters of letters, digits, dot, dash, underscore or colon.`, { path: "idempotencyKey" });
  }

  c.merge(checkPlatformLimits(p, { title: req.title, caption: p === "youtube" ? undefined : req.caption, description: p === "youtube" ? req.caption : undefined, hashtags: req.hashtags ?? [] }));

  if (req.aiGenerated !== true) {
    c.error("payload.ai_label", "The AI-generated label is not set to true; this studio's videos are AI-made.", { path: "aiGenerated", fix: "Set aiGenerated to true." });
  }
  if (p === "tiktok" && !req.tiktokPrivacy) c.error("payload.tiktok_privacy_missing", "TikTok needs a privacy setting.", { path: "tiktokPrivacy", fix: 'Set "public", "friends" or "private".' });
  if (p === "youtube" && req.youtubeMadeForKids === undefined) c.warn("payload.youtube_made_for_kids", "madeForKids isn't set; YouTube requires an answer.", { path: "youtubeMadeForKids" });

  const videos = (req.media ?? []).filter((m) => m.kind === "video");
  if (videos.length !== 1) c.error("payload.video_count", `${videos.length} videos; a Short/Reel/TikTok post needs exactly one.`, { path: "media", fix: "Attach the one rendered video." });
  if ((req.media ?? []).some((m) => m.kind === "image")) c.error("payload.mixed_media", "Images are attached to a video post.", { path: "media", fix: "Post the video alone." });
  const rule = MEDIA_RULES[p];
  (req.media ?? []).forEach((m, i) => {
    const path = `media[${i}]`;
    if (!m.url && !m.localPath) c.error("payload.media_no_source", `Media ${i + 1} has neither a url nor a local path.`, { path });
    if (m.url && !/^https:\/\//i.test(m.url)) c.error("payload.media_url", `Media ${i + 1} url must be https.`, { path: `${path}.url` });
    if (m.mimeType && m.kind === "video" && !VIDEO_MIME.test(m.mimeType)) c.error("payload.media_type", `Media ${i + 1} is ${m.mimeType}; export H.264 MP4.`, { path: `${path}.mimeType` });
    if (m.kind === "video" && m.durationS !== undefined) {
      if (m.durationS < rule.minVideoS) c.error("payload.video_too_short", `The video is ${m.durationS}s; ${p} needs at least ${rule.minVideoS}s.`, { path: `${path}.durationS` });
      if (m.durationS > rule.maxVideoS) c.error("payload.video_too_long", `The video is ${m.durationS}s; ${p} allows up to ${rule.maxVideoS}s.`, { path: `${path}.durationS` });
    }
  });

  if (req.scheduledAt !== undefined) {
    if (!ISO_WITH_ZONE.test(req.scheduledAt) || Number.isNaN(Date.parse(req.scheduledAt))) {
      c.error("payload.schedule_format", `scheduledAt "${req.scheduledAt}" must be an ISO time with a timezone.`, { path: "scheduledAt", fix: "e.g. 2026-10-21T14:00:00Z" });
    } else {
      const now = (opts.now ?? new Date()).getTime();
      const lead = opts.minLeadMs ?? 2 * 60_000;
      if (Date.parse(req.scheduledAt) < now + lead) c.error("payload.schedule_past", `scheduledAt ${req.scheduledAt} is in the past or too soon.`, { path: "scheduledAt" });
    }
  }
  return c.result();
}
