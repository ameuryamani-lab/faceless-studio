// Fills a new room source (src/salle-iso-source.txt from the room artifact, placeholders left) with the assets of the
// current salle-source.html, then writes it as the new salle-source.html. Run: node office/salle/fill-source.cjs <source.txt>
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'salle-source.html');
const old = fs.readFileSync(OUT, 'utf8');
let src = fs.readFileSync(process.argv[2], 'utf8');
const grab = (re, name) => { const m = re.exec(old); if (!m) throw new Error(`missing ${name}`); return m[1]; };
const block = (id, type = 'application/json') => new RegExp(`<script type="${type}" id="${id}">([\\s\\S]*?)</script>`);
const vals = {
  __ROOM_GLTF_JSON__: grab(block('room-gltf'), 'room-gltf'),
  __ROOM_LAYOUT_JSON__: grab(block('room-layout'), 'room-layout'),
  __DEMO_JSON__: grab(block('demo-data'), 'demo-data'),
  __STILL_DAY_JPG_B64__: grab(block('still-day', 'text/plain'), 'still-day'),
  __STILL_NIGHT_JPG_B64__: grab(block('still-night', 'text/plain'), 'still-night'),
  __ROBOT_GLB_B64__: grab(/const ROBOT_GLB = "([^"]*)"/, 'robot'),
  __LESTER_GLB_B64__: grab(/const LESTER_GLB = "([^"]*)"/, 'lester'),
  __ROOM_NIGHT_SHELL_JPG_B64__: grab(/const ROOM_NIGHT_SHELL = "data:image\/jpeg;base64,([^"]*)"/, 'night shell'),
  __ROOM_NIGHT_PROPS_JPG_B64__: grab(/const ROOM_NIGHT_PROPS = "data:image\/jpeg;base64,([^"]*)"/, 'night props'),
};
for (const [k, v] of Object.entries(vals)) { if (!src.includes(k)) throw new Error(`no ${k} in the new source`); src = src.split(k).join(v); }
if (/__[A-Z_]+_(B64|JSON)__/.test(src)) throw new Error('placeholder left');
fs.writeFileSync(OUT, old.slice(0, old.indexOf('<title>')) + src + '</body></html>');
console.log('salle-source.html filled');
