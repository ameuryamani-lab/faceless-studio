// A desk screen showing the real work (viewers like to see it): the trend found, the subject, the story
// lines, the still being drawn, the voice, the cover with the QC stamp or the 3 platforms. Drawn in the screens' 72 by 52.6 box.
import type { ComponentType } from "react";
import type { DeskWork } from "../live/types";
import { at, SH, SW } from "./screens/bits";

const NETS = ["#ff0033", "#e1306c", "#25f4ee"];

/** Splits a line into chunks of at most n characters on word boundaries. */
function wrap(text: string, n: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = `${cur} ${w}`.trim();
  }
  if (cur) out.push(cur);
  return out;
}

function Lines({ lines, tint, y0 = 7 }: { lines: string[]; tint: string; y0?: number }) {
  const rows = lines.flatMap((l, i) => wrap(l, 30).map((r) => ({ r, first: i === 0 }))).slice(0, 7);
  return (
    <g>
      {rows.map((x, i) => (
        <text key={i} x={4} y={y0 + i * 6.4} fontSize={4.6} fontWeight={x.first ? 700 : 500} fill={x.first ? tint : "#f4eeff"} className="i-pop" style={at(0.05 + i * 0.11)}>
          {x.r}
        </text>
      ))}
    </g>
  );
}

export function WorkView({ work, tint, Fallback }: { work: DeskWork; tint: string; Fallback?: ComponentType<{ tint: string }> }) {
  if (work.kind === "text") {
    return (
      <g>
        <rect x={0} y={0} width={SW} height={SH} fill="#120a20" />
        <Lines lines={work.lines ?? []} tint={tint} />
      </g>
    );
  }
  if (work.kind === "wave") {
    return (
      <g>
        {Fallback ? <Fallback tint={tint} /> : null}
        {work.lines?.[0] ? (
          <g>
            <rect x={0} y={SH - 10} width={SW} height={10} fill="#120a20" opacity={0.85} />
            <text x={3} y={SH - 3.4} fontSize={4.2} fill="#f4eeff">{wrap(work.lines[0], 32)[0]}</text>
          </g>
        ) : null}
      </g>
    );
  }
  return (
    <g>
      <rect x={0} y={0} width={SW} height={SH} fill="#120a20" />
      <image href={work.url} x={0} y={0} width={SW} height={SH} preserveAspectRatio="xMidYMid slice" className={work.zoom ? "wk-zoom" : "wk-in"} />
      {work.stamp === "ok" ? (
        <g className="i-pop" style={at(0.35)}>
          <circle cx={SW - 10} cy={10} r={7.5} fill="#22c55e" stroke="#fff" strokeWidth={1} />
          <path d={`M${SW - 13.5},10 l2.6,2.6 l4.8,-5`} fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
        </g>
      ) : null}
      {work.nets ? NETS.map((c, i) => <rect key={c} x={6 + i * 22} y={SH - 9} width={18} height={6} rx={3} fill={c} className="i-pop" style={at(0.2 + i * 0.2)} />) : null}
    </g>
  );
}
