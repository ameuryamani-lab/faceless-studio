// Builds office/public/salle.html (the 3D room in the vitrine, 2026-10-24) from salle-source.html (the published room page,
// assets inlined) + bridge.js (live data). Run: node office/salle/build-salle.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let html = readFileSync(join(here, "salle-source.html"), "utf8");
// Covers come from the vitrine server (/media/..., /thumb/...): same origin, so getImg also takes paths starting with "/".
const GATE = "if (!src || typeof src !== 'string' || !src.startsWith('data:')) return null;";
if (!html.includes(GATE)) throw new Error("getImg gate not found in salle-source.html");
html = html.replace(GATE, "if (!src || typeof src !== 'string' || !(src.startsWith('data:') || src.startsWith('/media/') || src.startsWith('/thumb/'))) return null;");
const bridge = readFileSync(join(here, "bridge.js"), "utf8");
if (!html.includes("</body>")) throw new Error("no </body> in salle-source.html");
html = html.replace("</body>", () => `<script>${bridge}</script></body>`);
writeFileSync(join(here, "..", "public", "salle.html"), html);
console.log(`salle.html: ${(html.length / 1e6).toFixed(1)} MB`);
