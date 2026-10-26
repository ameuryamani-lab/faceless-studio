// The top of the panel: what matters first, in big numbers. The total
// views of all 3 networks, the views and followers per network, and the next video to go out with its countdown.

import type { StudioState } from "../live/types";

const NETS = [
  { id: "instagram", label: "Instagram", color: "#ff6fae" },
  { id: "tiktok", label: "TikTok", color: "#7dd3fc" },
  { id: "youtube", label: "YouTube", color: "#ffb547" },
] as const;

const big = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} M` : n.toLocaleString("fr-FR"));
const small = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} M` : n >= 10_000 ? `${Math.round(n / 1000)} k` : n.toLocaleString("fr-FR"));

function countdown(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (!(ms > 60_000)) return "maintenant";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `dans ${h} h ${String(m).padStart(2, "0")}` : `dans ${m} min`;
}

export function Headline({ state, now }: { state: StudioState | null; now: number }) {
  const t = state?.stats?.totals;
  const next = [...(state?.queue?.ready ?? [])].filter((v) => v.publish_at).sort((a, b) => Date.parse(a.publish_at!) - Date.parse(b.publish_at!))[0];
  if (!t && !next) return null;
  const total = t ? t.instagram.views + t.tiktok.views + t.youtube.views : null;
  return (
    <div className="hl">
      {total !== null && t ? (
        <>
          <p className="hl-label">Vues de nos vidéos</p>
          <p className="hl-total">{big(total)}</p>
          <div className="hl-nets">
            {NETS.map((n) => (
              <div key={n.id} className="hl-net">
                <i style={{ background: n.color }} />
                <b>{small(t[n.id].views)}</b>
                <span>{n.label}</span>
                <small>{t[n.id].followers === null ? "" : `${small(t[n.id].followers!)} abonnés`}</small>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {next ? (
        <div className="hl-next">
          <div className="hl-cover" style={next.cover ? { backgroundImage: `url(${next.cover})` } : undefined} />
          <div className="hl-next-text">
            <p className="hl-label">Prochaine vidéo</p>
            <p className="hl-when">{countdown(next.publish_at!, now)}</p>
            <p className="hl-title">{next.title}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
