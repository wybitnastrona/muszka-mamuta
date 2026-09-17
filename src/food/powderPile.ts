/**
 * Authored creatine powder fill. Sits in the KFD tub well (centre / radius
 * from layout). Not connectome data.
 */
import { Xoshiro128ss } from '../brain/rng.ts';
import {
  PILE_CELL_COUNT,
  PILE_MM,
  PILE_TOTAL_MASS_G,
  mm,
} from '../scene/scale.ts';
import type { ChunkRecord, Vec3 } from './twarogSystem.ts';

export type PowderSpec = {
  chunks: ChunkRecord[];
  biteFront: Vec3;
  hx: number;
  hy: number;
  hz: number;
  radius: number;
  height: number;
};

export function pileHeightAt(x: number, z: number, radius: number, height: number): number {
  const r = Math.hypot(x, z);
  if (r >= radius) return 0;
  const u = 1 - r / radius;
  return height * u * u;
}

export function makePowderChunks(opts: {
  seed?: number;
  radius?: number;
  height?: number;
  count?: number;
  massGrams?: number;
} = {}): PowderSpec {
  const radius = opts.radius ?? mm(PILE_MM.radius);
  const height = opts.height ?? mm(PILE_MM.height);
  const count = opts.count ?? PILE_CELL_COUNT;
  const massGrams = opts.massGrams ?? PILE_TOTAL_MASS_G;
  const rng = new Xoshiro128ss(opts.seed ?? 1);
  const hx = radius;
  const hy = height / 2;
  const hz = radius;
  const cellMass = massGrams / count;
  const chunks: ChunkRecord[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const r = radius * Math.sqrt(u) * (0.92 + 0.08 * rng.nextFloat());
    const ang = i * golden + rng.nextFloat() * 0.15;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const h = pileHeightAt(x, z, radius, height);
    const localTop = -hy + h;
    const grain = Math.max(1.4, 2.4 * (h / Math.max(height, 1e-6)) + 1.1);
    const centroid: Vec3 = {
      x,
      y: localTop - grain * 0.45,
      z,
    };
    chunks.push({
      index: i,
      centroid,
      massGrams: cellMass,
      biteDistance: Math.hypot(x, z + radius * 0.85),
      neighbours: [],
      eaten: false,
      topY: localTop,
      radiusXz: grain * 0.85,
    });
  }
  const neighbourR = radius * 0.28;
  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      const a = chunks[i]!;
      const b = chunks[j]!;
      if (Math.hypot(a.centroid.x - b.centroid.x, a.centroid.z - b.centroid.z) <= neighbourR) {
        a.neighbours.push(j);
        b.neighbours.push(i);
      }
    }
  }
  const biteFront: Vec3 = { x: 0, y: -hy * 0.2, z: -radius * 0.82 };
  return { chunks, biteFront, hx, hy, hz, radius, height };
}
