#!/usr/bin/env node
/**
 * Przegląd same-frame appearance before/after. Authored still — not connectome.
 * Writes docs/review/appearance-before-after.png
 *
 * GPU frame time is not captured here (no WebGL in this script). Chrome was
 * unavailable in the previous live pass; keep cuticle clearcoat + wing
 * iridescence until a GPU sample shows >4 ms extra.
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { overviewFrame } from '../src/body/cameras.ts';
import { kitchenLayout } from '../src/scene/layout.ts';
import { CURD_MM, POUCH_MM, mm } from '../src/scene/scale.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/review/appearance-before-after.png');

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
  W: ['#     #', '#     #', '#  #  #', '# # # #', '##   ##', ' #   # ', '       '],
  Y: [' #   # ', '  # #  ', '   #   ', '   #   ', '   #   ', '   #   ', '       '],
  '0': ['  ###  ', ' #   # ', ' #  ## ', ' # # # ', ' ##  # ', '  ###  ', '       '],
  '1': ['   #   ', '  ##   ', '   #   ', '   #   ', '   #   ', '  ###  ', '       '],
  '4': [' #  #  ', ' #  #  ', ' ##### ', '    #  ', '    #  ', '    #  ', '       '],
  '-': ['       ', '       ', ' ##### ', '       ', '       ', '       ', '       '],
  '.': ['       ', '       ', '       ', '       ', '       ', '  ##   ', '       '],
  '/': ['     # ', '    #  ', '   #   ', '  #    ', ' #     ', ' #     ', '       '],
};

function plot(
  px: Uint8Array, w: number, h: number, x: number, y: number,
  r: number, g: number, b: number,
  clip?: { x0: number; y0: number; x1: number; y1: number },
): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
  if (clip && (xi < clip.x0 || yi < clip.y0 || xi >= clip.x1 || yi >= clip.y1)) return;
  const o = (yi * w + xi) * 4;
  px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
}

function fillRect(
  px: Uint8Array, w: number, h: number, x: number, y: number, rw: number, rh: number,
  r: number, g: number, b: number,
  clip?: { x0: number; y0: number; x1: number; y1: number },
): void {
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) plot(px, w, h, x + i, y + j, r, g, b, clip);
}

function fillEllipse(
  px: Uint8Array, w: number, h: number, cx: number, cy: number, rx: number, ry: number,
  r: number, g: number, b: number,
  clip?: { x0: number; y0: number; x1: number; y1: number },
): void {
  for (let j = -ry; j <= ry; j++) {
    for (let i = -rx; i <= rx; i++) {
      if ((i * i) / (rx * rx) + (j * j) / (ry * ry) <= 1) plot(px, w, h, cx + i, cy + j, r, g, b, clip);
    }
  }
}

function drawText(
  px: Uint8Array, w: number, h: number, x: number, y: number, text: string, s = 2,
  clip?: { x0: number; y0: number; x1: number; y1: number },
): void {
  let ox = x;
  const ascii = text.toUpperCase().replace(/[Ł]/g, 'L');
  for (const raw of ascii) {
    const ch = GLYPH[raw] ? raw : (raw === ' ' ? ' ' : '-');
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

function project(
  p: { x: number; y: number; z: number },
  cam: { position: [number, number, number]; lookAt: [number, number, number]; fov: number },
  vw: number,
  vh: number,
): { x: number; y: number } | null {
  const fx = cam.lookAt[0] - cam.position[0];
  const fy = cam.lookAt[1] - cam.position[1];
  const fz = cam.lookAt[2] - cam.position[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const zx = fx / fl, zy = fy / fl, zz = fz / fl;
  let rx = zz, ry = 0, rz = -zx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; rz /= rl;
  const tx = zy * rz - zz * ry, ty = zz * rx - zx * rz, tz = zx * ry - zy * rx;
  const dx = p.x - cam.position[0], dy = p.y - cam.position[1], dz = p.z - cam.position[2];
  const camZ = dx * zx + dy * zy + dz * zz;
  if (camZ < 1) return null;
  const camX = dx * rx + dy * ry + dz * rz;
  const camY = dx * tx + dy * ty + dz * tz;
  const f = 1 / Math.tan((cam.fov * Math.PI / 180) / 2);
  return { x: ((camX * f) / camZ * 0.5 + 0.5) * vw, y: (1 - (camY * f) / camZ * 0.5 - 0.5) * vh };
}

function fillTri(
  px: Uint8Array, w: number, h: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
  r: number, g: number, b: number,
  clip?: { x0: number; y0: number; x1: number; y1: number },
): void {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      const w1 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
      const w2 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
      if (w0 >= 0 && w1 >= 0 && w2 >= 0 || w0 <= 0 && w1 <= 0 && w2 <= 0) {
        plot(px, w, h, x, y, r, g, b, clip);
      }
    }
  }
}

function drawPanel(
  px: Uint8Array, W: number, H: number,
  x0: number, y0: number, pw: number, ph: number,
  after: boolean,
): void {
  const clip = { x0, y0, x1: x0 + pw, y1: y0 + ph };
  fillRect(px, W, H, x0, y0, pw, ph, 8, 10, 14);
  for (let g = 0; g < 12; g++) {
    fillRect(px, W, H, x0, y0 + 40 + g * 36, pw, 1, 18, 22, 28, clip);
    fillRect(px, W, H, x0 + 24 + g * 48, y0 + 36, 1, ph - 48, 18, 22, 28, clip);
  }
  const layout = kitchenLayout();
  const base = overviewFrame();
  const ox = base.position[0] - layout.fly.x;
  const oz = base.position[2] - layout.fly.z;
  const az = Math.hypot(ox, oz) || 1;
  const dist = 210;
  const cam = {
    position: [layout.curd.x + (ox / az) * dist, 92, layout.curd.z + (oz / az) * dist] as [number, number, number],
    lookAt: [layout.curd.x * 0.6 + layout.fly.x * 0.4, 8, layout.curd.z * 0.6 + layout.fly.z * 0.4] as [number, number, number],
    fov: 40,
  };
  const to = (p: { x: number; y: number; z: number }) => {
    const q = project(p, cam, pw - 24, ph - 64);
    if (!q) return null;
    return { x: x0 + 12 + q.x, y: y0 + 40 + q.y };
  };
  const tablePts = [
    to({ x: -210, y: 0, z: -170 }),
    to({ x: 210, y: 0, z: -170 }),
    to({ x: 210, y: 0, z: 170 }),
    to({ x: -210, y: 0, z: 170 }),
  ];
  const tr = after ? [215, 192, 154] : [90, 61, 40];
  if (tablePts[0] && tablePts[1] && tablePts[2] && tablePts[3]) {
    fillTri(px, W, H, tablePts[0].x, tablePts[0].y, tablePts[1].x, tablePts[1].y, tablePts[2].x, tablePts[2].y, tr[0]!, tr[1]!, tr[2]!, clip);
    fillTri(px, W, H, tablePts[0].x, tablePts[0].y, tablePts[2].x, tablePts[2].y, tablePts[3].x, tablePts[3].y, tr[0]!, tr[1]!, tr[2]!, clip);
  }
  if (after) {
    const plate = to({ x: layout.curd.x, y: 0.4, z: layout.curd.z });
    if (plate) fillEllipse(px, W, H, plate.x, plate.y + 8, 52, 22, 243, 239, 230, clip);
  }
  const hx = mm(CURD_MM.width) / 2;
  const hz = mm(CURD_MM.length) / 2;
  const hy = mm(CURD_MM.height);
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
  const edges: [number, number][] = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const cheese = after ? [225, 214, 196] : [210, 198, 176];
  for (const [a, b] of edges) {
    const pa = cube[a], pb = cube[b];
    if (!pa || !pb) continue;
    const dx = pb.x - pa.x, dy = pb.y - pa.y, n = Math.hypot(dx, dy) || 1;
    for (let t = 0; t <= n; t++) plot(px, W, H, pa.x + dx * t / n, pa.y + dy * t / n, cheese[0]!, cheese[1]!, cheese[2]!, clip);
  }
  const pouch = to({ x: layout.pouch.x, y: mm(POUCH_MM.height) * 0.04, z: layout.pouch.z });
  if (pouch) {
    const pc = after ? [70, 98, 108] : [78, 108, 118];
    fillRect(px, W, H, pouch.x - 18, pouch.y - 6, 36, 12, pc[0]!, pc[1]!, pc[2]!, clip);
  }
  const fly = to({ x: layout.fly.x, y: 3, z: layout.fly.z });
  if (fly) {
    const body = after ? [184, 114, 47] : [158, 104, 52];
    const eye = after ? [138, 26, 18] : [173, 51, 31];
    const leg = after ? [197, 132, 66] : [187, 137, 73];
    fillEllipse(px, W, H, fly.x, fly.y, 10, 6, body[0]!, body[1]!, body[2]!, clip);
    fillEllipse(px, W, H, fly.x + 8, fly.y - 2, 5, 4, eye[0]!, eye[1]!, eye[2]!, clip);
    if (after) fillEllipse(px, W, H, fly.x + 10, fly.y - 3, 2, 2, 255, 236, 210, clip);
    fillRect(px, W, H, fly.x - 14, fly.y - 1, 10, 2, leg[0]!, leg[1]!, leg[2]!, clip);
  }
  if (after) {
    const spoon = to({ x: 180, y: 4, z: -110 });
    if (spoon) fillRect(px, W, H, spoon.x, spoon.y, 40, 3, 201, 196, 184, clip);
    for (let i = 0; i < 6; i++) {
      const c = to({ x: layout.curd.x + 48 + i * 3, y: 0.7, z: layout.curd.z + 40 - i * 5 });
      if (c) fillRect(px, W, H, c.x, c.y, 3, 2, 225, 215, 202, clip);
    }
  }
  drawText(px, W, H, x0 + 12, y0 + 10, after ? 'AFTER  PHYSICAL' : 'BEFORE  STANDARD', 2, clip);
}

function main(): void {
  const header = 40;
  const pw = 640, ph = 480;
  const W = pw * 2, H = ph + header;
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 8; px[i + 1] = 10; px[i + 2] = 14; px[i + 3] = 255;
  }
  drawText(px, W, H, 12, 10, 'PRZEGLAD  SAME FRAME  AUTHORED LOOK');
  drawText(px, W, H, 12, 26, 'GPU MS NOT MEASURED - KEEP CLEARCOAT', 1);
  drawPanel(px, W, H, 0, header, pw, ph, false);
  drawPanel(px, W, H, pw, header, pw, ph, true);
  writePng(OUT, W, H, px);
  console.log(`wrote ${OUT}`);
  console.log('frame time: GPU not captured (software PNG; no Chrome/WebGL sample)');
  console.log('budget gate: keep cuticle clearcoat and wing iridescence until a GPU delta > 4 ms');
}

main();
