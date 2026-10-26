# Faceless Studio office

The live "office" page: an isometric room with the Chief of Staff on the dais, 7 teams × 3 desks (one per agent), the Brand Brain in the middle, and two wall feeds ("Our channel" on the left, "Trending" on the right). A side panel shows what needs approval, the next video, stats per platform and recent work.

Ported from the AttentionOS worker room (MIT licence, see `../licences/`). Every file adapted from it carries a credit header.

## Start

```
node office/server.mjs
```

Then open:

- http://127.0.0.1:8830 for the live office (reads `data/studio.db`, read-only)
- http://127.0.0.1:8830/?demo=1 for the demo day (runs entirely in the browser, generic names, DEMO badge)

Phone access (optional): `node office/server.mjs --tailnet <your private VPN address>` also listens there. On first start the
server generates a random access key in `data/office-key.txt` (local only, never committed, kept out by `.gitignore`); open
`http://<address>:8830/?k=<key>` once and the browser keeps a cookie. With `--tailnet`, the same `?k=<key>` on 127.0.0.1 also enables the Stop button.

Options in the address: `&speed=2` (demo speed, 0.25 to 4), `&tour=1` (camera tour instead of the wide shot).
Keys: arrows move the camera, H holds the wide shot, F goes full screen. "Hide panel" gives the room the whole screen.

## Rebuild after editing `src/`

```
node office/build.mjs          (one build, minified)
node office/build.mjs --watch  (rebuild on save)
```

The bundle goes to `public/app.js` and `public/app.css`. esbuild and React come from `../node_modules` (nothing to install).

## How it works

- `server.mjs`: plain `node:http`, listens on 127.0.0.1:8830 only, GET and HEAD only. Routes: `/` (the page), `/api/state`, `/api/events?after=<id>` (Server-Sent Events, the database is polled every second, heartbeat every 15 s), `/media/<video_id>/thumbnail.jpg|png|webp` (cover images, if present). The database is opened with `readOnly: true`. Without `data/studio.db` it returns an empty state. Rows with `demo = 1` are never shown in live mode. `--db <file>` points at another database (for tests).
- Live mode: a desk animates only when its agent's `state` is `working` or a `run_start` event for it has not been closed by `run_end`. `handoff` flies a ticket from `agent` to `to_agent`, `approval_request` flies to the Chief, `publish` flies to the "Our channel" wall, `error` turns the desk red.
- Demo mode: `src/live/demo.ts` replays research → strategy → writing → character → visual → sound & edit → the Chief asks for approval → distribution, then loops with a new topic. Nothing is sent to the server.

## Known limits

- Live extras (`studio-files.mjs`, read-only, cached ~4 s): `/api/state` also returns `renders` (shot-by-shot progress from `media/<id>/keyframes/shotNN/pick.png`, `clips/shotNN[-take].mp4`, rejected takes and GPU times from `log.md` / clip JSON, shot list from `media/<id>/storyboard.json`, ETA), `approvals_queue`, `runs_today` (UTC day), `paused`, `schedule` (from `core/daily.json`, in the studio time zone of `core/local-config.mjs`), `daily_log`, `errors`, and `model` / `effort` per agent. Panel sections fold; Schedule and Problems are hidden in demo mode. `--port <n>` runs a test instance (127.0.0.1 only).
- The render ETA is GPU time only (average clip time × clips left); manual keyframe picks are not counted.
- Opening a WAL-mode database read-only lets SQLite create `studio.db-shm` / `studio.db-wal` next to it; the data itself is never written.
- Stats sum each video's latest metrics snapshot per platform; "—" means no snapshot yet.
