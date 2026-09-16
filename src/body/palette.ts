import type { BoneName } from './types.ts';
import { BONE_NAMES } from './types.ts';

export const BONE_COLORS: Record<BoneName, readonly [number, number, number]> = {
  root: [0.42, 0.44, 0.5],
  abdomen: [0.62, 0.32, 0.82],
  head: [0.18, 0.42, 0.95],
  antenna_L: [0.15, 0.92, 0.95],
  antenna_R: [0.08, 0.68, 0.78],
  rostrum: [1, 0.52, 0.12],
  haustellum: [1, 0.86, 0.18],
  labellum_L: [0.95, 0.18, 0.78],
  labellum_R: [0.95, 0.16, 0.22],
  foreleg_L_tarsus: [0.18, 0.86, 0.32],
  foreleg_R_tarsus: [0.48, 0.95, 0.38],
};

export const BONE_PALETTE = BONE_NAMES.map((name) => BONE_COLORS[name]);

export const WEIGHT_LEGEND: { name: BoneName; hex: string }[] = BONE_NAMES.map((name) => {
  const [r, g, b] = BONE_COLORS[name];
  const hex = '#' + [r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
  return { name, hex };
});
