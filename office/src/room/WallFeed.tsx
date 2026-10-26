// Adapted from AttentionOS (MIT licence, Copyright (c) 2026 The AttentionOS Authors), commit 89f6781,
// apps/studio/src/components/worker-room/. See licences/ATTENTIONOS-LICENSE. Changes for Faceless Studio.
// The feed: phone screens on the two back walls. The left wall is "Our channel": our latest videos with their real
// views (from the videos and posts tables); a publish event lands on a left wall phone, which flashes and moves to
// the next video. The right wall is "Trending": the latest trend scan (title, views, ratio to the channel median),
// blank phones until the first scan. Empty walls show blank phones.

import { memo } from "react";
import { compact, planeX, planeY, S, Z } from "./iso";
import { D, H, PHONE, phoneStart, WALL_PHONES } from "./layout";
import { P } from "./palette";
import type { FeedCard } from "./types";

const PW = PHONE.w * S;
const PH = (PHONE.z1 - PHONE.z0) * Z;
const IN = 3;
const VW = PW - IN * 2;
const VH = PH - IN * 2;

function Glyphs() {
  return (
    <g fill="none" stroke="#fff" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${VW - 8},${VH - 49} c-5,-3.6 -2.6,-7.4 0,-4.6 c2.6,-2.8 5,1 0,4.6 Z`} fill="#fff" stroke="none" />
      <path d={`M${VW - 11.6},${VH - 40} h7.2 a1.6,1.6 0 0 1 1.6,1.6 v3.4 a1.6,1.6 0 0 1 -1.6,1.6 h-3.4 l-2.4,2 v-2 h-1.4 a1.6,1.6 0 0 1 -1.6,-1.6 v-3.4 a1.6,1.6 0 0 1 1.6,-1.6 Z`} />
      <path d={`M${VW - 11.4},${VH - 22.4} l7,-3.2 l-2.6,7 l-1.2,-2.8 Z`} />
    </g>
  );
}

function short(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const Phone = memo(function Phone({ card, flash, delay, scan, linkOn }: { card: FeedCard | null; flash: number; delay: number; scan: boolean; linkOn: boolean }) {
  const caption = card ? short(card.title, 20) : "";
  const ratio = card && typeof card.ratio === "number" ? `${card.ratio >= 10 ? Math.round(card.ratio) : card.ratio.toFixed(1)}×` : "";
  const body = (
    <g style={card?.href ? { cursor: "pointer" } : undefined}>
      {card?.detail ? <title>{`${card.title} · ${card.detail}`}</title> : null}
      <rect x={0} y={0} width={PW} height={PH} rx={8.5} fill="#05030a" stroke="#5a4490" strokeWidth={1.3} />
      <svg x={IN} y={IN} width={VW} height={VH} viewBox={`0 0 ${VW} ${VH}`}>
        <rect width={VW} height={VH} fill="url(#wr-phone-blank)" />
        {card ? (
          <g key={card.id} className="wr-feed-swipe">
            {card.cover ? <image href={card.cover} x={0} y={0} width={VW} height={VH} preserveAspectRatio="xMidYMid slice" /> : null}
          </g>
        ) : (
          <g opacity={0.5}>
            <circle cx={VW / 2} cy={VH / 2 - 6} r={7} fill="none" stroke={P.lilac} strokeWidth={1} />
            <path d={`M${VW / 2 - 2},${VH / 2 - 9.5} l5,3.5 l-5,3.5 Z`} fill={P.lilac} />
          </g>
        )}
        <rect width={VW} height={VH} fill="url(#wr-phone-shade)" />
        <rect x={4} y={4} width={VW - 8} height={1.6} rx={0.8} fill="#fff" opacity={0.35} />
        {card ? <rect x={4} y={4} width={VW - 8} height={1.6} rx={0.8} fill="#fff" className="wr-feed-progress" style={{ animationDelay: `${-delay}s` }} /> : null}
        {card ? <Glyphs /> : null}
        {caption ? (
          <text x={4.5} y={VH - 16.5} fontSize={5.9} fontWeight={600} fill="#fff">
            {caption}
          </text>
        ) : null}
        {card && card.views !== null ? (
          <>
            <path d={`M5,${VH - 11.6} l5.4,3.3 l-5.4,3.3 Z`} fill="#fff" />
            <text x={13} y={VH - 4.6} fontSize={9.4} fontWeight={700} fill="#fff" className="wr-num">
              {compact(card.views)}
            </text>
          </>
        ) : null}
        {ratio ? (
          <text x={VW - 4.5} y={15} fontSize={8.2} fontWeight={800} fill={P.pink} textAnchor="end" className="wr-num">
            {ratio}
          </text>
        ) : null}
        {card?.notUsable ? (
          <g>
            <rect x={3} y={21} width={VW - 6} height={9} rx={2} fill="#05030a" opacity={0.82} stroke={P.pink} strokeWidth={0.6} />
            <text x={VW / 2} y={27.6} fontSize={5.4} fontWeight={800} fill={P.pink} textAnchor="middle" letterSpacing={0.3}>
              À ÉVITER
            </text>
          </g>
        ) : null}
        {card?.badge ? (
          <g>
            <rect x={3} y={card.notUsable ? 32 : 21} width={VW - 6} height={9} rx={2} fill={card.badge === "EN LIGNE" ? "#1f9d55" : card.badge === "PRÊTE" || card.badge.startsWith("✓") ? "#d97706" : "#6d28d9"} opacity={0.92} />
            <text x={VW / 2} y={(card.notUsable ? 32 : 21) + 6.6} fontSize={5.4} fontWeight={800} fill="#fff" textAnchor="middle" letterSpacing={0.3}>
              {card.badge}
            </text>
          </g>
        ) : null}
        {card?.age ? (
          <text x={VW - 4.5} y={VH - 4.6} fontSize={6.4} fontWeight={700} fill="#fff" textAnchor="end" className="wr-num">
            {card.age}
          </text>
        ) : null}
        {scan && card ? <rect x={0} y={-4} width={VW} height={4} fill={P.pink} opacity={0.8} className="wr-feed-scan" style={{ animationDelay: `${delay}s` }} /> : null}
      </svg>
      <rect x={1.6} y={1.6} width={PW - 3.2} height={PH - 3.2} rx={7.4} fill="none" stroke="#05030a" strokeWidth={3.2} />
      {flash ? (
        <g key={flash} className="wr-feed-flash">
          <rect x={-2.5} y={-2.5} width={PW + 5} height={PH + 5} rx={10.5} fill="none" stroke={P.pink} strokeWidth={3} />
          <rect x={IN} y={IN} width={VW} height={VH} rx={6} fill="#fff" className="wr-feed-white" />
        </g>
      ) : null}
    </g>
  );
  // Once the camera is on this wall, a tap opens the YouTube post, our own final cut or the trend's source (new tab);
  // before that, the tap only zooms (the wall's own click handler).
  return card?.href && linkOn ? (
    <a href={card.href} target="_blank" rel="noreferrer noopener">
      {body}
    </a>
  ) : (
    body
  );
});

/** Phone k shows card k; each post that lands on it moves it on by a full wall. */
function cardAt(cards: readonly FeedCard[], k: number, shift: number): FeedCard | null {
  if (!cards.length) return null;
  if (cards.length <= WALL_PHONES && shift === 0) return cards[k] ?? null;
  return cards[(k + shift * WALL_PHONES) % cards.length] ?? null;
}

export const WallFeed = memo(function WallFeed({ cards, trending, shifts, flashes, focus, onPickChannel, onPickTrending }: {
  cards: readonly FeedCard[];
  trending: readonly FeedCard[];
  shifts: readonly number[];
  flashes: readonly number[];
  /** The camera stop on screen: links work only on the wall being looked at. */
  focus: string;
  onPickChannel: () => void;
  onPickTrending: () => void;
}) {
  const ks = Array.from({ length: WALL_PHONES }, (_, k) => k);
  const v = (H - PHONE.z1) * Z;
  return (
    <g>
      <g transform={planeY(0, H)} onClick={focus === "trending" ? undefined : onPickTrending} className="wr-pick">
        {ks.map((k) => (
          <g key={k} transform={`translate(${phoneStart(k) * S} ${v})`}>
            <Phone card={cardAt(trending, k, 0)} flash={0} delay={k * 1.3} scan linkOn={focus === "trending"} />
          </g>
        ))}
      </g>
      <g transform={planeX(0, D, H)} onClick={focus === "feed" ? undefined : onPickChannel} className="wr-pick">
        {ks.map((k) => (
          <g key={k} transform={`translate(${(D - phoneStart(k) - PHONE.w) * S} ${v})`}>
            <Phone card={cardAt(cards, k, shifts[k] ?? 0)} flash={flashes[k] ?? 0} delay={k * 0.9 + 0.4} scan={false} linkOn={focus === "feed"} />
          </g>
        ))}
      </g>
    </g>
  );
});
