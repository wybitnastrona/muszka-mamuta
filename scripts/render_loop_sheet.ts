#!/usr/bin/env node
/**
 * Seed-1 loop contact sheet, camera Przegląd. Authored stills — not connectome.
 * Writes docs/review/loop-contact-sheet.png
 */
import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { SceneDirector } from '../src/body/sceneDirector.ts';
import { overviewFrame } from '../src/body/cameras.ts';
import { kitchenLayout } from '../src/scene/layout.ts';
import { CURD_MM, POUCH_MM, mm } from '../src/scene/scale.ts';
import { fractureCurdBlock } from '../src/food/proceduralTwarog.ts';
import { TwarogSystem } from '../src/food/twarogSystem.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/review/loop-contact-sheet.png');

const WANTED = [
  'ORBIT', 'LAND_TOP', 'WALK_TOP', 'EAT_TOP', 'GROOM_SHORT', 'TAKEOFF_1',
  'ORBIT_SHORT', 'LAND_TABLE', 'EAT_SIDE', 'GAG', 'GROOM_FULL', 'NAP',
] as const;

type Still = {
  label: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  mode: string;
  hud: string;
  caption: string;
};

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(path: string, w: number, h: number, rgba: Uint8Array): void {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  mkdirSync(dirname(path), { recursive: true });
  createWriteStream(path).end(png);
}

const GLYPH: Record<string, string[]> = {
  ' ': ['       ', '       ', '       ', '       ', '       ', '       ', '       '],
  A: ['  ###  ', ' #   # ', ' #   # ', ' ##### ', ' #   # ', ' #   # ', '       '],
  B: [' ##### ', ' #   # ', ' ##### ', ' #   # ', ' #   # ', ' ##### ', '       '],
  C: ['  #### ', ' #     ', ' #     ', ' #     ', ' #     ', '  #### ', '       '],
  D: [' ##### ', ' #   # ', ' #   # ', ' #   # ', ' #   # ', ' ##### ', '       '],
  E: [' ##### ', ' #     ', ' ####  ', ' #     ', ' #     ', ' ##### ', '       '],
  F: [' ##### ', ' #     ', ' ####  ', ' #     ', ' #     ', ' #     ', '       '],
  G: ['  #### ', ' #     ', ' #  ## ', ' #   # ', ' #   # ', '  #### ', '       '],
  H: [' #   # ', ' #   # ', ' ##### ', ' #   # ', ' #   # ', ' #   # ', '       '],
  I: ['  ###  ', '   #   ', '   #   ', '   #   ', '   #   ', '  ###  ', '       '],
  J: ['   ### ', '    #  ', '    #  ', '    #  ', ' #  #  ', '  ##   ', '       '],
  K: [' #   # ', ' #  #  ', ' ###   ', ' #  #  ', ' #   # ', ' #   # ', '       '],
  L: [' #     ', ' #     ', ' #     ', ' #     ', ' #     ', ' ##### ', '       '],
  M: ['#     #', '##   ##', '# # # #', '#  #  #', '#     #', '#     #', '       '],
  N: [' #   # ', ' ##  # ', ' # # # ', ' #  ## ', ' #   # ', ' #   # ', '       '],
  O: ['  ###  ', ' #   # ', ' #   # ', ' #   # ', ' #   # ', '  ###  ', '       '],
  P: [' ##### ', ' #   # ', ' #   # ', ' ##### ', ' #     ', ' #     ', '       '],
  R: [' ##### ', ' #   # ', ' #   # ', ' ##### ', ' #  #  ', ' #   # ', '       '],
  S: ['  #### ', ' #     ', '  ###  ', '     # ', '     # ', ' ####  ', '       '],
  T: [' ##### ', '   #   ', '   #   ', '   #   ', '   #   ', '   #   ', '       '],
  U: [' #   # ', ' #   # ', ' #   # ', ' #   # ', ' #   # ', '  ###  ', '       '],
  V: [' #   # ', ' #   # ', ' #   # ', ' #   # ', '  # #  ', '   #   ', '       '],
  W: ['#     #', '#     #', '#  #  #', '# # # #', '##   ##', ' #   # ', '       '],
  X: [' #   # ', '  # #  ', '   #   ', '   #   ', '  # #  ', ' #   # ', '       '],
  Y: [' #   # ', '  # #  ', '   #   ', '   #   ', '   #   ', '   #   ', '       '],
  Z: [' ##### ', '    #  ', '   #   ', '  #    ', ' #     ', ' ##### ', '       '],
  '0': ['  ###  ', ' #   # ', ' #  ## ', ' # # # ', ' ##  # ', '  ###  ', '       '],
  '1': ['   #   ', '  ##   ', '   #   ', '   #   ', '   #   ', '  ###  ', '       '],
  '2': ['  ###  ', ' #   # ', '    #  ', '   #   ', '  #    ', ' ##### ', '       '],
  '-': ['       ', '       ', ' ##### ', '       ', '       ', '       ', '       '],
  '/': ['     # ', '    #  ', '   #   ', '  #    ', ' #     ', ' #     ', '       '],
  _: ['       ', '       ', '       ', '       ', '       ', ' ##### ', '       '],
};

function plot(
  px: Uint8Array, w: number, h: number, x: number, y: number,
  r: number, g: number, b: number, a = 255,
  clip?: { x0: number; y0: number; x1: number; y1: number },
): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
  if (clip && (xi < clip.x0 || yi < clip.y0 || xi >= clip.x1 || yi >= clip.y1)) return;
  const o = (yi * w + xi) * 4;
  px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
}

function drawText(px: Uint8Array, w: number, h: number, x: number, y: number, text: string, s = 2, clip?: { x0: number; y0: number; x1: number; y1: number }): void {
  let ox = x;
  const ascii = text
    .toUpperCase()
    .replace(/[ĄÁÀÂÄ]/g, 'A')
    .replace(/[ĆÇ]/g, 'C')
    .replace(/[ĘÉÈÊ]/g, 'E')
    .replace(/[Ł]/g, 'L')
    .replace(/[ŃÑ]/g, 'N')
    .replace(/[ÓÒÔÖ]/g, 'O')
    .replace(/[ŚŞ]/g, 'S')
    .replace(/[ŹŻŽ]/g, 'Z');
  for (const raw of ascii) {
    const ch = GLYPH[raw] ? raw : '-';
    const rows = GLYPH[ch] ?? GLYPH['-']!;
    for (let ry = 0; ry < rows.length; ry++) {
      const row = rows[ry]!;
      for (let cx = 0; cx < row.length; cx++) {
        if (row[cx] === '#') fillRect(px, w, h, ox + cx * s, y + ry * s, s, s, 236, 232, 220, clip);
      }
    }
    ox += 8 * s;
  }
}

function fillRect(
  px: Uint8Array, w: number, h: number, x: number, y: number, rw: number, rh: number,
  r: number, g: number, b: number,
  clip?: { x0: number; y0: number; x1: number; y1: number },
): void {
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) plot(px, w, h, x + i, y + j, r, g, b, 255, clip);
}

function line(
  px: Uint8Array, w: number, h: number,
  x0: number, y0: number, x1: number, y1: number,
  r: number, g: number, b: number,
  clip?: { x0: number; y0: number; x1: number; y1: number },
): void {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (let n = 0; n < 800; n++) {
    plot(px, w, h, x, y, r, g, b, 255, clip);
    if (Math.round(x) === Math.round(x1) && Math.round(y) === Math.round(y1)) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function project(
  p: { x: number; y: number; z: number },
  cam: { position: [number, number, number]; lookAt: [number, number, number]; fov: number },
  vw: number,
  vh: number,
): { x: number; y: number; z: number } | null {
  const fx = cam.lookAt[0] - cam.position[0];
  const fy = cam.lookAt[1] - cam.position[1];
  const fz = cam.lookAt[2] - cam.position[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const zx = fx / fl, zy = fy / fl, zz = fz / fl;
  const ux = 0, uy = 1, uz = 0;
  let rx = uy * zz - uz * zy, ry = uz * zx - ux * zz, rz = ux * zy - uy * zx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const tx = zy * rz - zz * ry, ty = zz * rx - zx * rz, tz = zx * ry - zy * rx;
  const dx = p.x - cam.position[0], dy = p.y - cam.position[1], dz = p.z - cam.position[2];
  const camZ = dx * zx + dy * zy + dz * zz;
  if (camZ < 1) return null;
  const camX = dx * rx + dy * ry + dz * rz;
  const camY = dx * tx + dy * ty + dz * tz;
  const f = 1 / Math.tan((cam.fov * Math.PI / 180) / 2);
  const ndcX = (camX * f) / camZ;
  const ndcY = (camY * f) / camZ;
  return { x: (ndcX * 0.5 + 0.5) * vw, y: (1 - (ndcY * 0.5 + 0.5)) * vh, z: camZ };
}

function makeDirector() {
  const layout = kitchenLayout();
  const food = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
  return {
    layout,
    director: new SceneDirector({
      food,
      foodOrigin: { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z },
      pouch: {
        cx: layout.pouch.x, cz: layout.pouch.z,
        hx: mm(POUCH_MM.length) / 2, hz: mm(POUCH_MM.width) / 2, yaw: layout.pouch.yaw,
      },
      position: { x: layout.fly.x, y: 2, z: layout.fly.z },
      heading: 0.35,
      seed: 1,
      scriptedLoop: true,
    }),
  };
}

function collectStills(): Still[] {
  const { director } = makeDirector();
  const found = new Map<string, Still>();
  for (let i = 0; i < 6000; i++) {
    const out = director.update({
      dt: 1 / 30, mn9Rate: 20, satiety: 0.9, bitter: 0, odor: 1, cameraDist: 80, cropVolume: 0.35,
    });
    const key = out.macro;
    const still: Still = {
      label: out.caption ? `${key} ${out.caption}` : (key.startsWith('EAT') ? `${key}/${out.hudState}` : key),
      x: out.flyPose.position.x,
      y: out.flyPose.position.y,
      z: out.flyPose.position.z,
      heading: out.flyPose.heading,
      mode: out.mode,
      hud: out.hudState,
      caption: out.caption,
    };
    const prev = found.get(key);
    if (!prev) found.set(key, still);
    else if (key.startsWith('EAT') && still.hud === 'TASTE' && prev.hud !== 'TASTE') found.set(key, still);
    if (WANTED.every((k) => found.has(k) || (k === 'GAG' && found.has('EAT_SIDE_2')) || (k === 'NAP' && found.has('EXIT_FRAME')))) {
      if (found.size >= 10) break;
    }
  }
  const stills: Still[] = [];
  for (const key of WANTED) {
    const hit = found.get(key) ?? (key === 'GAG' ? found.get('EAT_SIDE_2') : null) ?? (key === 'NAP' ? found.get('WAKE') ?? found.get('EXIT_FRAME') : null);
    if (hit) stills.push(hit);
  }
  while (stills.length < 12) {
    const extra = [...found.values()].find((s) => !stills.includes(s));
    if (!extra) break;
    stills.push(extra);
  }
  return stills.slice(0, 12);
}

function drawCell(
  px: Uint8Array, W: number, H: number,
  col: number, row: number, cellW: number, cellH: number,
  still: Still, header = 32,
): void {
  const x0 = col * cellW;
  const y0 = header + row * cellH;
  const clip = { x0: x0 + 2, y0: y0 + 2, x1: x0 + cellW - 2, y1: y0 + cellH - 2 };
  fillRect(px, W, H, x0 + 1, y0 + 1, cellW - 3, cellH - 3, 16, 20, 28);
  const layout = kitchenLayout();
  const base = overviewFrame();
  const ox = base.position[0] - layout.fly.x;
  const oz = base.position[2] - layout.fly.z;
  const az = Math.hypot(ox, oz) || 1;
  const dist = 170;
  const cam = {
    position: [layout.curd.x + (ox / az) * dist, 100, layout.curd.z + (oz / az) * dist] as [number, number, number],
    lookAt: [layout.curd.x, 8, layout.curd.z] as [number, number, number],
    fov: 40,
  };
  const to = (p: { x: number; y: number; z: number }) => {
    const q = project(p, cam, cellW - 16, cellH - 48);
    if (!q) return null;
    return { x: x0 + 8 + q.x, y: y0 + 28 + q.y };
  };
  const hx = mm(CURD_MM.width) / 2, hz = mm(CURD_MM.length) / 2, hy = mm(CURD_MM.height);
  const cube = [
    { x: layout.curd.x - hx, y: 0, z: layout.curd.z - hz },
    { x: layout.curd.x + hx, y: 0, z: layout.curd.z - hz },
    { x: layout.curd.x + hx, y: 0, z: layout.curd.z + hz },
    { x: layout.curd.x - hx, y: 0, z: layout.curd.z + hz },
    { x: layout.curd.x - hx, y: hy, z: layout.curd.z - hz },
    { x: layout.curd.x + hx, y: hy, z: layout.curd.z - hz },
    { x: layout.curd.x + hx, y: hy, z: layout.curd.z + hz },
    { x: layout.curd.x - hx, y: hy, z: layout.curd.z + hz },
  ].map(to);
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [a, b] of edges) {
    const pa = cube[a], pb = cube[b];
    if (pa && pb) line(px, W, H, pa.x, pa.y, pb.x, pb.y, 210, 198, 176, clip);
  }
  const pouch = to({ x: layout.pouch.x, y: 4, z: layout.pouch.z });
  if (pouch) fillRect(px, W, H, pouch.x - 8, pouch.y - 4, 16, 8, 78, 108, 118, clip);
  const fly = to({ x: still.x, y: still.y, z: still.z });
  if (fly) {
    const nose = to({
      x: still.x + Math.sin(still.heading) * 12,
      y: still.y,
      z: still.z + Math.cos(still.heading) * 12,
    });
    fillRect(px, W, H, fly.x - 5, fly.y - 5, 11, 11, 196, 72, 42, clip);
    if (nose) fillRect(px, W, H, nose.x - 2, nose.y - 2, 5, 5, 236, 214, 92, clip);
    if (still.mode === 'flight') {
      fillRect(px, W, H, fly.x - 9, fly.y - 1, 19, 3, 90, 160, 200, clip);
    }
  }
  drawText(px, W, H, x0 + 8, y0 + 6, still.label.replace(/_/g, ' ').slice(0, 20), 2, clip);
}

function main(): void {
  const stills = collectStills();
  const cols = 4, rows = 3;
  const header = 32;
  const cellW = 400, cellH = 300;
  const W = cols * cellW, H = rows * cellH + header;
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 8; px[i + 1] = 10; px[i + 2] = 14; px[i + 3] = 255;
  }
  drawText(px, W, H, 12, 8, 'PRZEGLAD  SEED 1  AUTHORED LOOP', 2);
  stills.forEach((s, i) => drawCell(px, W, H, i % cols, Math.floor(i / cols), cellW, cellH, s, header));
  writePng(OUT, W, H, px);
  console.log(`wrote ${OUT} (${stills.length} stills)`);
  for (const s of stills) console.log(` - ${s.label}  mode=${s.mode}  y=${s.y.toFixed(1)}`);
}

main();
