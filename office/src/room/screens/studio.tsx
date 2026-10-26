// Desk screens written for Faceless Studio, in the style of the AttentionOS worker-room screens (MIT licence,
// Copyright (c) 2026 The AttentionOS Authors): a character sheet, a continuity check, storyboard frames, an image
// being painted, an animation timeline, a voice waveform on a timeline, a QC checklist, a results chart and a
// post-mortem page. Every screen is drawn in a 72 by 52 box; timing is a fraction of the work step.

import { at, from, Check, CELL, EDGE, INK, LILAC, Lines, MAGENTA, PINK, Star, Thumb, VIOLET, Wave, WAVE_A, type SceneProps } from "./bits";

/** Our hero, as a tiny round-headed figure. */
function Figure({ x, y, s = 1, fill = "#f4eeff", body = VIOLET }: { x: number; y: number; s?: number; fill?: string; body?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-6,14 Q-6,4 0,4 Q6,4 6,14 Z" fill={body} />
      <circle cx={0} cy={-1} r={5} fill={fill} />
      <rect x={-3} y={-2.4} width={6} height={2.4} rx={1.2} fill="#120a20" />
    </g>
  );
}

export function CharacterSheet({ tint }: SceneProps) {
  return (
    <g>
      <rect x={4} y={3} width={64} height={46.6} rx={2.4} fill="#f4eeff" />
      <rect x={8} y={6.5} width={18} height={3} rx={1.5} fill={PINK} />
      {[0, 1, 2].map((i) => (
        <g key={i} className="i-pop" style={at(0.06 + i * 0.16)}>
          <rect x={8 + i * 13} y={13} width={11} height={22} rx={1.6} fill="#e4dafa" />
          <Figure x={13.5 + i * 13} y={20} s={0.85} body={i === 1 ? tint : VIOLET} />
        </g>
      ))}
      {[0, 1, 2].map((i) => (
        <circle key={i} className="i-pop" style={at(0.5 + i * 0.06)} cx={11 + i * 7} cy={41} r={2.6} fill={[PINK, VIOLET, MAGENTA][i]} />
      ))}
      <Lines x={48} y={14} widths={[15, 12, 16, 10, 14]} gap={4.4} h={1.8} d0={0.3} step={0.08} fill="#6d5b96" />
      <Check cx={62} cy={42} r={4} d={0.84} />
    </g>
  );
}

export function ContinuityCheck({ tint }: SceneProps) {
  return (
    <g>
      {[0, 1].map((i) => (
        <g key={i}>
          <rect x={5 + i * 33} y={5} width={29} height={34} rx={2} fill={CELL} stroke={EDGE} strokeWidth={0.6} />
          <Figure x={19.5 + i * 33} y={18} s={1.25} body={tint} />
        </g>
      ))}
      <path className="i-grow" style={at(0.2, 0.3)} d="M5,22 H67" stroke={PINK} strokeWidth={0.8} strokeDasharray="2 2" />
      {[0, 1, 2].map((i) => (
        <g key={i} className="i-pop" style={at(0.45 + i * 0.12)}>
          <rect x={6 + i * 21} y={43} width={18} height={5} rx={2.5} fill={i === 2 ? PINK : tint} />
          <path d={`M${9 + i * 21},45.6 l1.4,1.4 l2.6,-2.6`} fill="none" stroke="#fff" strokeWidth={0.9} strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
}

const PANELS = [0, 1, 2, 3, 4, 5] as const;

export function Storyboard({ tint }: SceneProps) {
  return (
    <g>
      {PANELS.map((i) => {
        const x = 5 + (i % 3) * 21.5;
        const y = 4 + Math.floor(i / 3) * 23.5;
        return (
          <g key={i} className="i-pop" style={at(0.04 + i * 0.13)}>
            <rect x={x} y={y} width={19} height={15} rx={1} fill="#f4eeff" />
            <path d={`M${x + 2},${y + 13} L${x + 7},${y + 7 + (i % 2) * 2} L${x + 11},${y + 11} L${x + 17},${y + 5}`} fill="none" stroke="#6d5b96" strokeWidth={0.8} />
            <circle cx={x + 5 + (i % 3) * 4} cy={y + 6} r={2} fill="none" stroke={i === 4 ? PINK : "#6d5b96"} strokeWidth={0.8} />
            <rect x={x} y={y + 16.5} width={[14, 10, 16, 12, 9, 15][i]} height={1.8} rx={0.9} fill={i === 4 ? PINK : tint} />
          </g>
        );
      })}
    </g>
  );
}

const STROKES = [
  "M8,40 C18,30 30,44 44,34 C52,28 60,36 66,30",
  "M8,32 C20,22 34,30 48,20 C56,14 62,20 66,16",
  "M12,14 C20,8 28,16 36,10",
] as const;

export function ImageDraw({ tint }: SceneProps) {
  return (
    <g>
      <rect x={4} y={3} width={64} height={46.6} rx={2} fill="#1d1236" stroke={EDGE} strokeWidth={0.7} />
      <rect className="i-fade" style={at(0.06)} x={4} y={3} width={64} height={22} rx={2} fill={VIOLET} opacity={0.45} />
      <circle className="i-pop" style={at(0.2)} cx={54} cy={13} r={6} fill={PINK} opacity={0.85} />
      {STROKES.map((d, i) => (
        <path key={d} className="i-fade" style={at(0.3 + i * 0.12)} d={d} fill="none" stroke={i === 0 ? tint : LILAC} strokeWidth={3 - i * 0.6} strokeLinecap="round" />
      ))}
      <g className="i-pop" style={at(0.62)}>
        <Figure x={26} y={30} s={1.1} body={MAGENTA} />
      </g>
      <g className="i-move" style={from(0.1, 0.8, -44, 18)}>
        <path d="M58,40 L64,34 L66,36 L60,42 Z" fill={INK} />
        <path d="M58,40 L56.6,43.4 L60,42 Z" fill={PINK} />
      </g>
    </g>
  );
}

export function Animate({ tint }: SceneProps) {
  return (
    <g>
      <rect x={4} y={3} width={64} height={30} rx={2} fill={CELL} stroke={EDGE} strokeWidth={0.6} />
      {[0, 1, 2].map((i) => (
        <g key={i} opacity={0.25 + i * 0.12}>
          <Figure x={14 + i * 10} y={16 - (i % 2) * 3} s={0.9} body={LILAC} />
        </g>
      ))}
      <g className="i-move" style={from(0.05, 0.75, -32, 0)}>
        <Figure x={52} y={14} s={1} body={tint} />
      </g>
      <path d="M6,40 H66" stroke={EDGE} strokeWidth={0.8} />
      {[8, 18, 28, 38, 48, 58].map((x, i) => (
        <path key={x} className="i-pop" style={at(0.1 + i * 0.12)} d={`M${x},37.4 l2.6,2.6 l-2.6,2.6 l-2.6,-2.6 Z`} fill={i % 2 ? PINK : tint} />
      ))}
      <rect x={6} y={45} width={60} height={2.4} rx={1.2} fill={CELL} />
      <rect className="i-grow" style={at(0, 0.9)} x={6} y={45} width={60} height={2.4} rx={1.2} fill={PINK} />
    </g>
  );
}

export function SoundMix({ tint }: SceneProps) {
  return (
    <g>
      <path d="M5,6 H67 M5,4.5 V7.5 M20.5,5 V7 M36,4.5 V7.5 M51.5,5 V7 M67,4.5 V7.5" stroke={EDGE} strokeWidth={0.7} fill="none" />
      <rect x={5} y={11} width={62} height={11} rx={1.6} fill={CELL} />
      <Wave x={7} cy={16.5} heights={[...WAVE_A, ...WAVE_A.slice(0, 6)]} gap={3} w={1.6} fill={PINK} />
      <rect x={5} y={25} width={62} height={9} rx={1.6} fill={CELL} />
      <Wave x={7} cy={29.5} heights={[3, 5, 4, 6, 3, 5, 4, 3, 6, 4, 5, 3, 4, 6, 5, 3, 4, 5, 3, 4]} gap={3} w={1.6} fill={tint} />
      <rect x={5} y={37} width={30} height={6} rx={1.4} fill={VIOLET} className="i-grow" style={at(0.2, 0.3)} />
      <rect x={37} y={37} width={22} height={6} rx={1.4} fill={MAGENTA} className="i-grow" style={at(0.5, 0.25)} />
      <g className="i-move" style={from(0, 0.92, -60, 0)}>
        <path d="M65,9 V46" stroke="#fff" strokeWidth={1} />
        <path d="M62.6,8 H67.4 L65,11.6 Z" fill="#fff" />
      </g>
    </g>
  );
}

export function QcCheck({ tint }: SceneProps) {
  return (
    <g>
      <rect x={4} y={3} width={24} height={46.6} rx={3} fill="#05030a" stroke={EDGE} strokeWidth={0.8} />
      <Thumb x={5.6} y={4.6} w={20.8} h={43.4} n={4} edge="none" />
      {[0, 1, 2, 3, 4].map((i) => {
        const y = 6 + i * 9;
        return (
          <g key={i}>
            <rect x={33} y={y} width={34} height={6.4} rx={1.6} fill={CELL} stroke={EDGE} strokeWidth={0.4} />
            <rect x={36} y={y + 2.3} width={[18, 14, 20, 12, 16][i]} height={1.8} rx={0.9} fill={LILAC} opacity={0.7} />
            <Check cx={63} cy={y + 3.2} r={2.6} d={0.12 + i * 0.15} fill={i === 4 ? PINK : tint} />
          </g>
        );
      })}
    </g>
  );
}

const BARS = [8, 12, 10, 18, 24, 34] as const;

export function Results({ tint }: SceneProps) {
  return (
    <g>
      <path d="M6,46 H66 M6,46 V6" stroke={EDGE} strokeWidth={0.7} />
      {BARS.map((h, i) => (
        <rect key={i} className="i-rise" style={at(0.06 + i * 0.1, 0.12)} x={10 + i * 9.4} y={45 - h} width={6} height={h} rx={1} fill={i === BARS.length - 1 ? PINK : tint} opacity={i === BARS.length - 1 ? 1 : 0.7} />
      ))}
      <path className="i-fade" style={at(0.68)} d="M13,36 L22,32 L31,34 L40,26 L49,20 L58,9" fill="none" stroke="#fff" strokeWidth={1} strokeLinecap="round" />
      <g className="i-pop" style={at(0.82)}>
        <Star cx={62} cy={8} s={1.1} />
      </g>
    </g>
  );
}

export function PostMortem({ tint }: SceneProps) {
  return (
    <g>
      <rect x={6} y={3.5} width={41} height={46} rx={2} fill="#f4eeff" />
      <rect x={10} y={7.5} width={20} height={3} rx={1.5} fill={PINK} />
      <Lines x={10} y={14} widths={[30, 26, 31, 22]} gap={3.7} h={1.8} d0={0.05} step={0.1} fill="#6d5b96" />
      <rect x={10} y={30} width={12} height={2.4} rx={1.2} fill={tint} className="i-pop" style={at(0.48)} />
      <Lines x={10} y={35} widths={[28, 24, 18]} gap={3.7} h={1.8} d0={0.52} step={0.1} fill="#6d5b96" />
      {[0, 1, 2].map((i) => (
        <g key={i} className="i-pop" style={at(0.3 + i * 0.2)}>
          <rect x={52} y={6 + i * 14.5} width={15} height={11.5} rx={2.2} fill={i === 2 ? PINK : tint} />
          <rect x={55} y={10.8 + i * 14.5} width={9} height={1.9} rx={0.95} fill={INK} opacity={0.9} />
        </g>
      ))}
    </g>
  );
}
