/**
 * Authored DataTexture payloads for fly / table look.
 * Colour references: assets/photos/twarog_plate.jpg and twarog_wood.jpg
 * (warmth only — those files are not imported).
 */
import { SimplexNoise } from './simplex.ts';

export const CUTICLE_AMBER = '#b8722f';
export const CUTICLE_ABDOMEN = '#8a4a1c';
export const CUTICLE_LEG = '#c48442';
export const EYE_RED = '#8a1a12';
export const OCELLUS = '#1a120c';
export const OAK_HEX = '#d7c09a';
export const PLATE_HEX = '#f3efe6';
export const TABLE_BEVEL_MM = 1;
export const TABLE_THICKNESS_MM = 22;
export const FOOT_SINK_MM = 0.3;
export const HEAD_STABILIZE = 0.6;
export const REEL_FOV_DEG = 38;
export const REEL_ELEV_DEG = 15;
export const HANDHELD_HZ = 0.1;
export const HANDHELD_AMP_MM = 1;
export const KEY_KELVIN = 3200;
export const EXPOSURE = 1.1;
export const TERGITE_BANDS = 5;

/** Tanner Helland kelvin → sRGB, clamped. */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * t ** -0.1332047592;
    g = 288.1221695283 * t ** -0.0755148492;
    b = 255;
  }
  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
  ];
}

export function kelvinToHex(kelvin: number): number {
  const [r, g, b] = kelvinToRgb(kelvin);
  return (r << 16) | (g << 8) | b;
}

export function fillSimplexRoughness(
  data: Uint8Array,
  size: number,
  seed: number,
  mean = 140,
  amp = 48,
): void {
  const n = new SimplexNoise(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = n.noise2(x * 0.17, y * 0.17) * 0.55 + n.noise2(x * 0.73, y * 0.73) * 0.45;
      const v = Math.max(0, Math.min(255, mean + amp * s));
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
}

/** Hexagonal facet normals, ~`cells` across. RG = xy, B = z in [0,1] tangent space. */
export function fillHexNormal(data: Uint8Array, size: number, cells = 30): void {
  const hexH = Math.sqrt(3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells;
      const v = (y / size) * cells;
      const row = Math.round(v / hexH);
      const col = Math.round(u - (row & 1) * 0.5);
      const cx = col + (row & 1) * 0.5;
      const cy = row * hexH;
      const dx = u - cx;
      const dy = v - cy;
      const nx = Math.max(-1, Math.min(1, dx * 1.8));
      const ny = Math.max(-1, Math.min(1, dy * 1.8));
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(nz * 255);
      data[i + 3] = 255;
    }
  }
}

/** Opaque at the root, transparent at the tip (V). */
export function fillBristleAlpha(data: Uint8Array, size: number): void {
  for (let y = 0; y < size; y++) {
    const tip = y / Math.max(1, size - 1);
    const a = Math.round(255 * Math.max(0, 1 - tip * tip));
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = a;
      data[i + 1] = a;
      data[i + 2] = a;
      data[i + 3] = a;
    }
  }
}

export function fillOakAlbedo(data: Uint8Array, size: number, seed: number): void {
  const n = new SimplexNoise(seed);
  const base = [215, 192, 154];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = n.noise2(x * 0.02, y * 0.31) * 0.5 + n.noise2(x * 0.11, y * 1.4) * 0.5;
      const warm = 1 + grain * 0.12;
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, base[0] * warm));
      data[i + 1] = Math.max(0, Math.min(255, base[1] * warm * 0.98));
      data[i + 2] = Math.max(0, Math.min(255, base[2] * (1 + grain * 0.08)));
      data[i + 3] = 255;
    }
  }
}

/** Radial baked contact-AO / foot blob. Black RGB, alpha falls off with radius. */
export function fillContactAo(data: Uint8Array, size: number): void {
  const c = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c) / Math.max(1, c);
      const a = Math.round(255 * Math.max(0, 1 - r) ** 2.2);
      const i = (y * size + x) * 4;
      data[i] = 12;
      data[i + 1] = 8;
      data[i + 2] = 6;
      data[i + 3] = a;
    }
  }
}
