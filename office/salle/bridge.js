// Live data for the 3D room (office/public/salle.html).
// Polls /api/state every 12 s, maps it to the room's window.studio.setState contract, and only sends what changed
// (every setState with `now` restarts the agent sequence). Live mode (only real work is shown): the page runs no
// demo cycle; `now` is null when nobody works. The SSE event stream (/api/events) wakes the bridge at once and keeps a short
// real step on screen (a publish, a hand-off) even when it ends between two polls. The page walks hand-offs itself.
(() => {
  const POLL_MS = 12_000;
  const EVENT_HOLD_MS = 20_000; // how long a real event (run start, hand-off, publish) stays on screen after it happened
  let lastEvent = null;
  // The 3 agents of each service, in the order of the room's AGENT_JOBS (job 0, 1, 2).
  const TEAM_AGENTS = {
    research: ["trend_scout", "teardown_analyst", "outlier_analyst"],
    strategy: ["strategist", "calendar_planner", "topic_editor"],
    writing: ["copywriter", "hook_auditor", "fact_checker"],
    character: ["character_keeper", "voice_writer", "continuity_checker"],
    visual: ["storyboard_artist", "image_artist", "animator"],
    sound_edit: ["voice_director", "editor", "qc_inspector"],
    distribution: ["publisher", "results_analyst", "postmortem_writer"],
  };
  const AGENT_TEAM = {};
  for (const [team, ids] of Object.entries(TEAM_AGENTS)) ids.forEach((id, i) => { AGENT_TEAM[id] = { team, i }; });

  const clean = (s) => String(s ?? "").replace(/^\s*\[[^\]]*\]\s*/, "");
  const ytId = (url) => /(?:shorts\/|v=|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url ?? "")?.[1] ?? null;
  const studioClock = (iso) => new Intl.DateTimeFormat("fr-FR", { timeZone: globalThis.STUDIO_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  function ageDays(d) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(d ?? ""));
    return m ? Math.max(0, Math.round((Date.now() - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86_400_000)) : null;
  }

  function totals(s) {
    const t = s.stats?.totals;
    if (!t) return null;
    const v = (n) => t[n]?.views ?? 0;
    return { views: v("instagram") + v("tiktok") + v("youtube"), instagram: v("instagram"), tiktok: v("tiktok"), youtube: v("youtube"),
      followers: ["instagram", "tiktok", "youtube"].reduce((n, k) => n + (t[k]?.followers ?? 0), 0) };
  }

  // Our 4 best published videos, with each network's views.
  function ours(s) {
    return [...(s.queue?.published ?? [])].sort((a, b) => (b.views?.total ?? 0) - (a.views?.total ?? 0)).slice(0, 4).map((p) => ({
      title: clean(p.title), views: p.views?.total ?? 0, cover: p.cover ?? undefined,
      network_views: { instagram: p.views?.instagram ?? 0, tiktok: p.views?.tiktok ?? 0, youtube: p.views?.youtube ?? 0 },
    }));
  }

  function next(s) {
    const r = [...(s.queue?.ready ?? [])].filter((v) => v.publish_at).sort((a, b) => a.publish_at.localeCompare(b.publish_at))[0] ?? s.queue?.ready?.[0];
    return r ? { title: clean(r.title), time: r.publish_at ? studioClock(r.publish_at) : undefined, cover: r.cover ?? undefined } : null;
  }

  // The latest scan's trends, usable ones first, with their real thumbnails (cached by the server under /thumb/).
  function trends(s) {
    return [...(s.trends ?? [])].sort((a, b) => Number(b.usable === 1) - Number(a.usable === 1)).slice(0, 4).map((t) => {
      const id = ytId(t.video_url);
      return { title: t.title || "Trending Short", channel: t.channel ?? undefined, views: t.views ?? undefined, age_days: ageDays(t.upload_date) ?? undefined,
        source: t.source === "tiktok" ? "tiktok" : "youtube", cover: id ? `/thumb/${id}.jpg` : undefined };
    });
  }

  function nowOf(agentId, task, videoId, s) {
    const { team, i } = AGENT_TEAM[agentId];
    const v = (s.videos ?? []).find((x) => x.id === videoId);
    return { team_id: team, agent_index: i, step_label: String(task || "Au travail").replace(/^(working|idle):\s*/, "").split(" « ")[0].slice(0, 40), video_title: v ? clean(v.topic) : undefined, cover: v?.cover ?? undefined };
  }

  // Who works right now: an agent marked working, else the last real event if it is recent, else nobody (null).
  function now(s) {
    const a = (s.agents ?? []).filter((x) => x.state === "working" && AGENT_TEAM[x.id]).sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)))[0];
    if (a) return nowOf(a.id, a.task, a.video_id, s);
    const e = lastEvent;
    if (!e || Date.now() - e.seen > EVENT_HOLD_MS) return null;
    if (e.kind === "handoff" && AGENT_TEAM[e.to_agent]) return nowOf(e.to_agent, e.text, e.video_id, s);
    if (e.kind === "publish") return nowOf("publisher", "Publication", e.video_id, s);
    if (e.kind === "run_start" && AGENT_TEAM[e.agent]) return nowOf(e.agent, e.text, e.video_id, s);
    return null;
  }

  // The last real action, for the page's idle strip: {time: 'HH:MM' studio time, text: short French}.
  const JOB_SHORT = { research: ["veille", "analyse", "idées"], strategy: ["cap", "saison", "sujet"], writing: ["histoire", "accroche", "faits"],
    character: ["casting", "répliques", "continuité"], visual: ["scènes", "images", "animation"], sound_edit: ["voix", "montage", "qualité"], // "casting" since 2026-10-24: the hero is the concept's
    distribution: ["publication", "chiffres", "leçons"] };
  function lastAction(s) {
    for (const e of [...(s.recent ?? [])].reverse()) {
      const nets = e.kind === "publish" ? /published: (.+?)(?: \(|$)/.exec(e.text ?? "")?.[1] : null;
      if (nets) return { time: studioClock(e.at), text: `vidéo publiée sur ${nets}`.slice(0, 40) };
      if (e.kind === "run_end" && AGENT_TEAM[e.agent]) {
        const { team, i } = AGENT_TEAM[e.agent];
        return { time: studioClock(e.at), text: `terminé : ${JOB_SHORT[team][i]}` };
      }
    }
    return null;
  }

  const mode = (s) => (s.paused || s.production_paused || s.schedule?.in_quiet_hours ? "repos" : "travail");

  let last = {};
  let first = true;
  let busy = false;
  async function tick() {
    const studio = window.studio;
    if (!studio || busy) return;
    busy = true;
    try {
      const res = await fetch("/api/state", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = await res.json();
      globalThis.STUDIO_TZ = s.schedule?.timezone ?? globalThis.STUDIO_TZ; // the studio time zone (core/local-config.mjs), for every clock shown
      // No show yet (fresh studio): the next-video card says what to do instead of a title.
      const upcoming = next(s) ?? (s.concept?.active ? { title: "Prochaine vidéo en préparation" } : { title: "Aucune émission : lancez la création du concept" });
      const fresh = { totals: totals(s), ours: ours(s), next: upcoming, trends: trends(s), now: now(s), last: lastAction(s), mode: mode(s) };
      const patch = first ? { live: true } : {};
      for (const [k, v] of Object.entries(fresh)) {
        const j = JSON.stringify(v);
        // `now: null` is sent too (nobody works: the page clears the card); other empty fields are skipped.
        if ((v || k === "now") && (!Array.isArray(v) || v.length) && j !== last[k]) patch[k] = v;
        last[k] = j;
      }
      first = false;
      if (Object.keys(patch).length) studio.setState(patch);
      window.salleLive = { at: new Date().toISOString(), sent: Object.keys(patch), now: fresh.now };
    } catch (err) {
      window.salleLive = { at: new Date().toISOString(), error: String(err?.message ?? err) };
    } finally {
      busy = false;
    }
  }

  function listen() {
    try {
      const es = new EventSource("/api/events");
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data);
          if (["run_start", "handoff", "publish"].includes(e.kind)) lastEvent = { ...e, seen: Date.now() };
          if (["run_start", "run_end", "handoff", "publish"].includes(e.kind)) setTimeout(tick, 400);
        } catch { /* a malformed event is skipped */ }
      };
    } catch { /* no event stream: the 12 s poll still runs */ }
  }

  const start = () => { tick(); setInterval(tick, POLL_MS); listen(); };
  // window.studio appears once the module has booted the scene.
  const wait = setInterval(() => { if (window.studio) { clearInterval(wait); start(); } }, 300);
})();
