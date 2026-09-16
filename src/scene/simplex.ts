import { Xoshiro128ss } from '../brain/rng.ts';

/**
 * Seeded classic simplex noise (Gustavson). Values in about [-1, 1].
 */
export class SimplexNoise {
  private perm: Uint8Array;
  private permMod12: Uint8Array;

  constructor(seed: number) {
    const src = new Uint8Array(256);
    for (let i = 0; i < 256; i++) src[i] = i;
    const rng = new Xoshiro128ss(seed);
    for (let i = 255; i > 0; i--) {
      const j = rng.nextUint32() % (i + 1);
      const t = src[i];
      src[i] = src[j]!;
      src[j] = t!;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      const v = src[i & 255]!;
      this.perm[i] = v;
      this.permMod12[i] = v % 12;
    }
  }

  noise2(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.permMod12[ii + this.perm[jj]!]!;
    const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]!]!;
    const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]!]!;
    return 70 * (this.grad2(gi0, x0, y0) + this.grad2(gi1, x1, y1) + this.grad2(gi2, x2, y2));
  }

  noise3(xin: number, yin: number, zin: number): number {
    const F3 = 1 / 3;
    const G3 = 1 / 6;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);
    let i1: number, j1: number, k1: number;
    let i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }
    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const gi0 = this.permMod12[ii + this.perm[jj + this.perm[kk]!]!]!;
    const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]!]!]!;
    const gi2 = this.permMod12[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]!]!]!;
    const gi3 = this.permMod12[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]!]!]!;
    return 32 * (
      this.grad3(gi0, x0, y0, z0) +
      this.grad3(gi1, x1, y1, z1) +
      this.grad3(gi2, x2, y2, z2) +
      this.grad3(gi3, x3, y3, z3)
    );
  }

  private grad2(hash: number, x: number, y: number): number {
    const gx = [1, -1, 1, -1, 1, -1, 0, 0][hash % 8]!;
    const gy = [1, 1, -1, -1, 0, 0, 1, -1][hash % 8]!;
    const t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    const t2 = t * t;
    return t2 * t2 * (gx * x + gy * y);
  }

  private grad3(hash: number, x: number, y: number, z: number): number {
    const h = hash % 12;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    const t = 0.5 - x * x - y * y - z * z;
    if (t < 0) return 0;
    const t2 = t * t;
    return t2 * t2 * ((h & 1 ? -u : u) + (h & 2 ? -v : v));
  }
}
