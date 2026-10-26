// Faceless Studio promo composition (see promo.html).
(() => {
  const FPS = 30;
  const q = new URLSearchParams(location.search);
  const NUM = { videos: +(q.get('videos') || 10), runs: +(q.get('runs') || 120), tokens: q.get('tokens') || '3.2M' };
  const ROOMS = Array.from({ length: 12 }, (_, i) => `promo/room-${String(i + 1).padStart(2, '0')}.jpg`);
  const COVERS = Array.from({ length: 8 }, (_, i) => `promo/cover-${String(i + 1).padStart(2, '0')}.jpg`);
  const STILLS = Array.from({ length: 18 }, (_, i) => `promo/still-${String(i + 1).padStart(2, '0')}.jpg`);
  // Your own titles (comma-separated in ?titles=…); the images come from office/public/promo/ (room-01..12.jpg, cover-01..08.jpg,
  // still-01..18.jpg), which you fill with pictures of YOUR studio and YOUR videos: nothing is shipped there.
  const TITLES = (q.get('titles') || 'Your first story,Your second story,Your third story').split(',').map((s) => s.trim()).filter(Boolean);
  const AGENTS = ['TREND SCOUT', 'TOPIC EDITOR', 'COPYWRITER', 'HOOK AUDITOR', 'FACT CHECKER', 'STORYBOARD', 'IMAGE ARTIST', 'VOICE', 'EDITOR', 'QC INSPECTOR'];
  const STEPS = ['📈', '✍️', '🔎', '🖼️', '🎙️', '🎬', '✅', '🚀'];

  const root = document.getElementById('root');
  const el = (cls, html = '', parent = root) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; parent.appendChild(d); return d; };
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const back = (x) => { x = clamp(x); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const win = (t, a, b) => t >= a && t < b;
  const prog = (t, a, b) => clamp((t - a) / (b - a));

  // Scene A: hook
  const A = el('layer'); const aBg = el('bg', '', A); aBg.style.backgroundImage = `url(${ROOMS[0]})`; el('shade', '', A);
  const aL1 = el('big', 'THIS<br>CHANNEL', A); aL1.style.cssText += 'top:560px;font-size:190px';
  const aL2 = el('big pink', 'RUNS<br>ITSELF', A); aL2.style.cssText += 'top:1020px;font-size:210px';
  // Scene B: agents
  const B = el('layer'); const bBg = el('bg', '', B); el('shade', '', B);
  const bNum = el('big violet', '', B); bNum.style.cssText += 'top:330px;font-size:300px';
  const bTxt = el('big', 'AI AGENTS', B); bTxt.style.cssText += 'top:640px;font-size:110px';
  const chips = AGENTS.map((n, i) => { const c = el('chip', n, B); c.style.left = (i % 2 ? 560 : 90) + 'px'; c.style.top = (900 + Math.floor(i / 2) * 150) + 'px'; return c; });
  // Scene C: one video, three states
  const C = el('layer'); const cBg = el('bg', '', C); cBg.style.backgroundImage = `url(${ROOMS[6]})`; cBg.style.filter = 'blur(18px) brightness(0.35)';
  const steps = STEPS.map((s, i) => { const d = el('step', s, C); d.style.left = (84 + i * 116) + 'px'; return d; });
  const card = el('card', '', C); card.style.backgroundImage = `url(${STILLS[4]})`; const cBar = el('bar', '', card);
  const cState = el('state', '', C);
  const pills = [['YouTube', '#ff0033'], ['TikTok', '#25f4ee'], ['Instagram', '#e1306c']].map(([n, col], i) => { const p = el('pill', n, C); p.style.background = col; p.style.left = (120 + i * 300) + 'px'; return p; });
  // Scene D: montage
  const D = el('layer'); const dBg = el('bg', '', D); const dTitle = el('title', '', D); const dFlash = el('flash', '', D);
  // Scene E: numbers
  const E = el('layer'); const eBg = el('bg', '', E); eBg.style.backgroundImage = `url(${ROOMS[9]})`; eBg.style.filter = 'blur(20px) brightness(0.3)';
  const eHead = el('big', 'SINCE<br>LAST NIGHT', E); eHead.style.cssText += 'top:180px;font-size:120px';
  const stats = [['VIDEOS PUBLISHED', NUM.videos, '#22c55e'], ['AI AGENT RUNS', NUM.runs, '#a855f7'], ['TOKENS', NUM.tokens, '#facc15'], ['HUMAN EDITS', 0, '#ef4444']].map(([label, value, col], i) => {
    const s = el('stat', `<b>${label}</b><span></span><em></em>`, E); s.style.top = (560 + i * 300) + 'px'; s.querySelector('em').style.background = col; return { s, value, col };
  });
  // Scene F: outro
  const F = el('layer'); const tiles = COVERS.map((c, i) => { const t = el('tile', '', F); t.style.backgroundImage = `url(${c})`; t.style.left = (40 + (i % 3) * 340) + 'px'; return t; });
  el('shade', '', F);
  const fL1 = el('big', 'FOLLOW', F); fL1.style.cssText += 'top:640px;font-size:200px';
  const fL2 = el('big pink', 'TO WATCH<br>IT GROW', F); fL2.style.cssText += 'top:880px;font-size:150px';
  const fL3 = el('big', 'a new story every hour', F); fL3.style.cssText += 'top:1260px;font-size:58px;font-weight:700;color:#b9a9d6;letter-spacing:0';
  const live = el('live', '<i></i>AI STUDIO · LIVE');
  const flash = el('flash', '');

  const scenes = [[A, 0, 3.2], [B, 3.2, 11], [C, 11, 19.5], [D, 19.5, 29], [E, 29, 37], [F, 37, 42]];
  window.PROMO_SECONDS = 42;

  window.renderFrame = (n) => {
    const t = n / FPS;
    for (const [L, a, b] of scenes) L.style.display = win(t, a, b) ? 'block' : 'none';
    live.querySelector('i').style.opacity = Math.floor(t * 2) % 2 ? 0.35 : 1;
    // flash on every scene change
    const cut = scenes.map((s) => s[1]).filter((x) => x > 0).find((x) => t >= x && t < x + 0.18);
    flash.style.opacity = cut !== undefined ? 0.85 * (1 - (t - cut) / 0.18) : (t < 0.18 ? 1 - t / 0.18 : 0);

    if (win(t, 0, 3.2)) {
      aBg.style.transform = `scale(${1.5 + 0.35 * prog(t, 0, 3.2)})`;
      aL1.style.transform = `scale(${back(prog(t, 0.1, 0.55))})`; aL1.style.opacity = prog(t, 0.1, 0.3);
      aL2.style.transform = `scale(${back(prog(t, 0.75, 1.25))}) rotate(${-4 + 4 * ease(prog(t, 0.75, 1.3))}deg)`; aL2.style.opacity = prog(t, 0.75, 0.95);
    }
    if (win(t, 3.2, 11)) {
      const k = Math.floor((t - 3.2) / 0.45);
      bBg.style.backgroundImage = `url(${ROOMS[1 + (k % 11)]})`;
      bBg.style.transform = `scale(${1.35 - 0.12 * ((t - 3.2) % 0.45) / 0.45})`;
      bNum.textContent = String(Math.round(22 * ease(prog(t, 3.2, 4.6))));
      bNum.style.transform = `scale(${1 + 0.08 * Math.sin(t * 9)})`;
      chips.forEach((c, i) => {
        const at = 4.6 + i * 0.55;
        c.style.opacity = prog(t, at, at + 0.15); c.style.transform = `scale(${back(prog(t, at, at + 0.35))})`;
        c.classList.toggle('on', t > at + 0.35);
      });
    }
    if (win(t, 11, 19.5)) {
      const making = t < 14.2, ready = t >= 14.2 && t < 16.6, isLive = t >= 16.6;
      steps.forEach((s, i) => { const at = 11.2 + i * 0.36; s.style.background = t > at ? (i === Math.floor((t - 11.2) / 0.36) && making ? 'rgba(250,204,21,0.45)' : 'rgba(34,197,94,0.35)') : 'rgba(255,255,255,0.07)'; s.style.transform = `scale(${t > at && t < at + 0.25 ? 1.18 : 1})`; });
      const col = making ? '#8b8fa3' : ready ? '#facc15' : '#22c55e';
      card.style.borderColor = col;
      card.style.transform = `scale(${back(prog(t, 11, 11.5)) * (1 + (isLive ? 0.05 * Math.max(0, 1 - (t - 16.6) * 3) : 0))})`;
      cBar.style.width = `${100 * prog(t, 11.2, 14.1)}%`; cBar.style.display = making ? 'block' : 'none';
      cState.textContent = making ? 'IN PRODUCTION' : ready ? 'READY · 🕒' : 'LIVE ✓';
      const at0 = making ? 11 : ready ? 14.2 : 16.6;
      cState.style.color = col; cState.style.transform = `scale(${back(prog(t, at0, at0 + 0.35))})`;
      pills.forEach((p, i) => { const at = 17 + i * 0.3; p.style.opacity = prog(t, at, at + 0.12); p.style.transform = `translateY(${60 * (1 - ease(prog(t, at, at + 0.35)))}px) scale(${back(prog(t, at, at + 0.35))})`; });
    }
    if (win(t, 19.5, 29)) {
      const i = Math.min(STILLS.length - 1, Math.floor((t - 19.5) / 0.5));
      dBg.style.backgroundImage = `url(${STILLS[i]})`;
      dBg.style.transform = `scale(${1.22 - 0.14 * ease(((t - 19.5) % 0.5) / 0.5)}) rotate(${(i % 2 ? 1 : -1) * 1.5}deg)`;
      dFlash.style.opacity = ((t - 19.5) % 0.5) < 0.06 ? 0.5 : 0;
      dTitle.textContent = TITLES[Math.min(TITLES.length - 1, Math.floor(i / 3))];
      dTitle.style.transform = `scale(${back(prog((t - 19.5) % 1.5, 0, 0.3))})`;
    }
    if (win(t, 29, 37)) {
      eHead.style.opacity = prog(t, 29, 29.3);
      stats.forEach(({ s, value }, i) => {
        const at = 29.4 + i * 0.6;
        s.style.opacity = prog(t, at, at + 0.15); s.style.transform = `translateX(${-120 * (1 - ease(prog(t, at, at + 0.4)))}px)`;
        const p = ease(prog(t, at + 0.2, at + 1.6));
        const span = s.querySelector('span');
        if (typeof value === 'number') span.textContent = String(Math.round(value * p));
        else { const m = /^([\d.]+)(\D*)$/.exec(value); span.textContent = m ? `${(Number(m[1]) * p).toFixed(1)}${m[2]}` : value; }
        s.querySelector('em').style.width = `${(typeof value === 'number' && value === 0 ? 2 : 100) * p}%`;
      });
    }
    if (win(t, 37, 42)) {
      tiles.forEach((tile, i) => { tile.style.top = (1950 - ((t - 37) * 420 + Math.floor(i / 3) * 560 + (i % 3) * 120) % 2600) + 'px'; });
      fL1.style.transform = `scale(${back(prog(t, 37.1, 37.5)) * (1 + 0.04 * Math.sin(t * 8))})`; fL1.style.opacity = prog(t, 37.1, 37.3);
      fL2.style.transform = `scale(${back(prog(t, 37.5, 37.9))})`; fL2.style.opacity = prog(t, 37.5, 37.7);
      fL3.style.opacity = prog(t, 38.2, 38.6);
    }
  };
  window.renderFrame(0);
})();
