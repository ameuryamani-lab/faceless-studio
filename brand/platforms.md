# Platforms — limits and settings for the same video on three apps

Owner: `publisher`. Read by: publisher, editor, qc_inspector, results_analyst.
Accounts: your own `youtube` (Shorts), `instagram` (Reels) and `tiktok` accounts, connected to your Upload-Post profile (its name goes in your `.env`, never in a file of this repository).
One vertical video goes to all three in **one Upload-Post call**, sent by code (`core/publish-direct.mjs`, task "publication") at the studio's slots, with no approval step (the studio is autonomous). No agent sends anything.

**"verify" = not confirmed against the platform's current help pages or the Upload-Post docs. The publisher must not rely on a "verify" value without checking the dry-run response first, and must report it to the chief.**

| | YouTube Shorts | Instagram Reels | TikTok |
|---|---|---|---|
| Video | 1080×1920, 9:16, ≤60 s for this channel (Shorts allow up to 3 min — verify) | 1080×1920, 9:16 | 1080×1920, 9:16 |
| Title | ≤100 characters (hashtags in the title count) | no title field | no title field |
| Caption / description | description ≤5000 characters | caption ≤2200 characters | caption ≤4000 characters (verify; older limit 2200) |
| Hashtags | 3–5 in the description; more than 60 makes YouTube ignore them all (verify) | ≤30 by the contract; Instagram announced a lower cap in late 2025 (reported as 5) — verify, studio uses 3–5 | 3–5; they count toward the caption limit |
| AI label | "Altered or synthetic content" = Yes (Studio); API field `status.containsSyntheticMedia` (verify; check Upload-Post's parameter name) | "AI info" / "Add AI label" toggle (verify whether the API or Upload-Post exposes it; if not, the owner sets it by hand and the publisher says so before sending) | "AI-generated content" toggle; Content Posting API field `is_aigc` (verify; check Upload-Post's parameter name) |
| Made for kids | Set **No** unless the owner decides otherwise (verify field in Upload-Post) | n/a | n/a |
| Links in caption | Clickable in description (not used: no links on this channel) | Not clickable | Not clickable |

## Studio rules (stricter than the platforms)
- AI label ON for every post on every platform (`posts.ai_label = 1`). If a platform's label cannot be set through Upload-Post, the post is held and the owner is told which toggle to set by hand.
- Hashtags: 3–5 per platform, lowercase, letters/numbers/underscores, topic- and audience-specific. Never #fyp, #viral, #foryou, #explore or any broad reach tag.
- No links, no "link in bio", no keyword-comment or DM calls to action.
- No other brand's audio, logo, character or footage.
- Captions: first line = the hook in plain words, then one line of context, then (optional) a question that invites a real opinion. Same claims as the script's claim ledger, nothing new.
- Posting times: the slots of `core/daily.json` (`autonomy.two_a_day.slots`, studio time), decided by `results_analyst` (its `SLOTS:` line, applied at once), the same for all three; never two publications under 60 min apart.

## Upload-Post
- One call for the three platforms, with one idempotency key per video and version: `post:<video_id>:v<version>`.
- Dry run first (payload validation, nothing sent). Parameter names for AI labels, titles and per-platform captions — verify against Upload-Post's current API docs before the first real send.
- If the call times out or the answer is unclear ("may have posted"), never resend. Ask the owner to check the three apps.
