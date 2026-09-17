/**
 * Authored grooming and postprandial sleep. Not connectome-driven.
 *
 *   Seeds 2014 — hierarchical grooming (eyes → antennae → proboscis →
 *     abdomen → wings); forelegs for the head, hind legs for the wing
 *     phase, a pose-blend for abdomen, with a leg-rub interlude every two
 *     parts. Chen & Seeds 2025 for the later circuit map of the same hierarchy.
 *   Murphy 2016 — postprandial sleep after a sweet bout (satiety > 0.8).
 *
 * See docs/BODY-MODEL.md. Nothing here writes into ActivityFrame.
 */
import type { BoneName, EulerDeg, Pose } from './types.ts';
import { clamp01, lerp } from './math.ts';
import { overlayEuler } from './feedingMotion.ts';
import { raiseForDeltaDeg } from './wings.ts';

export const GROOM_SHORT_S = 3;
export const GROOM_FULL_S = 8;
export const NAP_BASE_S = 8;
export const WAKE_S = 1.15;
export const NAP_SATIETY = 0.8;
export const NAP_DROOP_DEG = 15;
export const NAP_BREATH_HZ = 0.3;
export const NAP_SINK_MM = 1;

export type GroomKind = 'short' | 'full';

export type GroomNapOverlay = {
  euler: Partial<Record<BoneName, EulerDeg>>;
  sinkMm: number;
  wingRaise: number;
  caption: string | null;
  done: boolean;
};

const FULL_PARTS: { name: 'eyes' | 'antennae' | 'proboscis' | 'abdomen' | 'wings'; t0: number; t1: number; rub?: boolean }[] = [
  { name: 'eyes', t0: 0, t1: 1.35 },
  { name: 'antennae', t0: 1.35, t1: 2.7 },
  { name: 'proboscis', t0: 3.1, t1: 4.45, rub: true },
  { name: 'abdomen', t0: 4.45, t1: 5.8 },
  { name: 'wings', t0: 6.2, t1: 8, rub: true },
];

function rubPose(phase: number): Partial<Record<BoneName, EulerDeg>> {
  const a = Math.sin(phase * Math.PI * 8) * 18;
  return {
    foreleg_L_tarsus: [-42 + a, 10, 22],
    foreleg_R_tarsus: [-42 - a, -10, -22],
  };
}

function partPose(name: (typeof FULL_PARTS)[number]['name'], u: number): Partial<Record<BoneName, EulerDeg>> {
  const w = Math.sin(u * Math.PI);
  switch (name) {
    case 'eyes':
      return {
        head: [12 * w, 8 * w, 0],
        foreleg_L_tarsus: [-55 * w, 18 * w, 30 * w],
        foreleg_R_tarsus: [-55 * w, -18 * w, -30 * w],
      };
    case 'antennae':
      return {
        antenna_L: [0, 22 * w, 0],
        antenna_R: [0, -22 * w, 0],
        foreleg_L_tarsus: [-48 * w, 14 * w, 18 * w],
        foreleg_R_tarsus: [-48 * w, -14 * w, -18 * w],
      };
    case 'proboscis':
      return {
        rostrum: [-18 * w, 0, 0],
        haustellum: [-22 * w, 0, 0],
        labellum_L: [0, 0, 10 * w],
        labellum_R: [0, 0, -10 * w],
        foreleg_L_tarsus: [-40 * w, 8 * w, 12 * w],
        foreleg_R_tarsus: [-40 * w, -8 * w, -12 * w],
      };
    case 'abdomen':
      return {
        abdomen: [16 * w, 0, 8 * Math.sin(u * Math.PI * 2)],
        root: [4 * w, 0, 0],
      };
    case 'wings': {
      const sweep = Math.sin(u * Math.PI * 6) * 38;
      return {
        abdomen: [6 * w, 0, 0],
        root: [2 * w, 0, 0],
        hindleg_L: [32 * w, 10 * w, 24 * w + sweep],
        hindleg_R: [32 * w, -10 * w, -24 * w - sweep],
      };
    }
  }
}

export function groomShortOverlay(t: number, slow = 1): GroomNapOverlay {
  const dur = GROOM_SHORT_S * slow;
  const u = clamp01(t / dur);
  const wipe = u < 0.5;
  const p = wipe ? u / 0.5 : (u - 0.5) / 0.5;
  const euler = wipe
    ? {
        rostrum: [-22 * Math.sin(p * Math.PI), 0, 0] as EulerDeg,
        haustellum: [-18 * Math.sin(p * Math.PI), 0, 0] as EulerDeg,
        labellum_L: [0, 0, 8 * Math.sin(p * Math.PI)] as EulerDeg,
        labellum_R: [0, 0, -8 * Math.sin(p * Math.PI)] as EulerDeg,
        head: [6 * Math.sin(p * Math.PI), 0, 0] as EulerDeg,
      }
    : rubPose(p);
  return { euler, sinkMm: 0, wingRaise: 0, caption: null, done: t >= dur };
}

export function groomFullOverlay(t: number): GroomNapOverlay {
  const u = clamp01(t / GROOM_FULL_S);
  let euler: Partial<Record<BoneName, EulerDeg>> = {};
  if ((t >= 2.7 && t < 3.1) || (t >= 5.8 && t < 6.2)) {
    euler = rubPose((t % 0.4) / 0.4);
  } else {
    for (const part of FULL_PARTS) {
      if (t >= part.t0 && t < part.t1) {
        euler = partPose(part.name, (t - part.t0) / Math.max(1e-4, part.t1 - part.t0));
        break;
      }
    }
  }
  const wingU = t >= 6.2 ? clamp01((t - 6.2) / 1.8) : 0;
  const wingRaise = t >= 6.2 ? raiseForDeltaDeg(30) * Math.sin(wingU * Math.PI) : 0;
  return { euler, sinkMm: 0, wingRaise, caption: null, done: u >= 1 };
}

export function napDuration(satiety: number, doubled = false): number {
  return NAP_BASE_S * clamp01(satiety) * (doubled ? 2 : 1);
}

export function napOverlay(t: number, satiety: number, doubled = false): GroomNapOverlay {
  const dur = napDuration(satiety, doubled);
  const breath = Math.sin(2 * Math.PI * NAP_BREATH_HZ * t);
  return {
    euler: {
      abdomen: [6 * breath, 0, 0],
      antenna_L: [NAP_DROOP_DEG, 4, 0],
      antenna_R: [NAP_DROOP_DEG, -4, 0],
      root: [3, 0, 0],
    },
    sinkMm: NAP_SINK_MM,
    wingRaise: 0,
    caption: 'Trawi',
    done: t >= dur,
  };
}

export function wakeOverlay(t: number): GroomNapOverlay {
  const twitch = t < 0.45;
  const euler = twitch
    ? { antenna_L: [0, 28 * Math.sin((t / 0.45) * Math.PI * 3), 0] as EulerDeg }
    : rubPose((t - 0.45) / 0.7);
  return { euler, sinkMm: lerp(NAP_SINK_MM, 0, clamp01((t - 0.2) / 0.6)), wingRaise: 0, caption: null, done: t >= WAKE_S };
}

export function applyGroomNap(pose: Pose, overlay: GroomNapOverlay): Pose {
  return overlayEuler(pose, overlay.euler);
}

export function canNap(satiety: number): boolean {
  return satiety > NAP_SATIETY;
}
