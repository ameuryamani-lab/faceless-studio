// Adapted from AttentionOS (MIT licence, Copyright (c) 2026 The AttentionOS Authors), commit 89f6781,
// apps/studio/src/components/worker-room/. See licences/ATTENTIONOS-LICENSE. Changes for Faceless Studio.
import { box, faces } from "./iso";

export type BoxArgs = readonly [number, number, number, number, number, number];

/** A box with three shaded faces. `edge` draws a thin light line around the top face. */
export function Box({ b, color, edge }: { b: BoxArgs; color: string; edge?: string }) {
  const f = box(...b);
  const c = faces(color);
  return (
    <g>
      <path d={f.left} fill={c.left} />
      <path d={f.right} fill={c.right} />
      <path d={f.top} fill={c.top} stroke={edge} strokeWidth={edge ? 0.8 : undefined} strokeLinejoin="round" />
    </g>
  );
}
