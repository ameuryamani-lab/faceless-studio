// Generic thumbnails drawn as tiny SVGs, for demo mode and for empty walls. No real channel, name or face.

const HUES = [268, 290, 248, 310, 230, 280, 255, 300] as const;

function svgUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A 9:16 cover: a gradient, a round-headed silhouette and two title bars. `seed` picks the colors and pose. */
export function makeCover(seed: number, warm = false): string {
  const h = HUES[((seed % HUES.length) + HUES.length) % HUES.length]!;
  const h2 = warm ? 20 + ((seed * 37) % 40) : (h + 40) % 360;
  const x = 40 + ((seed * 13) % 30);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 160">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h},70%,38%)"/><stop offset="1" stop-color="hsl(${h2},80%,${warm ? 45 : 22}%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="90" height="160" fill="url(#g)"/>` +
    `<circle cx="${70 - (seed % 3) * 20}" cy="34" r="16" fill="hsl(${h2},90%,75%)" opacity="0.35"/>` +
    `<ellipse cx="${x}" cy="150" rx="40" ry="34" fill="#0b0712" opacity="0.55"/>` +
    `<circle cx="${x}" cy="92" r="17" fill="#f4eeff"/>` +
    `<rect x="${x - 9}" y="88" width="18" height="7" rx="3.5" fill="#120a20"/>` +
    `<path d="M${x - 22},160 Q${x - 20},114 ${x},112 Q${x + 20},114 ${x + 22},160 Z" fill="#6d45e8"/>` +
    `<rect x="10" y="16" width="${46 + (seed % 4) * 6}" height="7" rx="2" fill="#fff" opacity="0.9"/>` +
    `<rect x="10" y="27" width="${30 + (seed % 3) * 8}" height="6" rx="2" fill="#fff" opacity="0.55"/>` +
    `</svg>`;
  return svgUri(svg);
}
