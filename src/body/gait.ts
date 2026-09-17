/**
 * Authored modified-tripod walk. Not connectome-driven.
 *
 *   Chun, Biswas & Bhandawat, eLife 2021 — M-tripod: tripods
 *     [L1, R2, L3] and [R1, L2, R3]; within a tripod the front leg leads
 *     the middle, which leads the hind (not a perfectly synchronous tripod).
 *   Wosnitza et al. 2013 — walking speed is set by step frequency; swing
 *     amplitude and swing duration stay roughly constant.
 *   Nature 2025, Fine-grained descending control of steering — outside
 *     legs lengthen and inside legs shorten (up to 5% of body length),
 *     and the front legs' step direction rotates into the turn, scaled
 *     by yaw rate.
 *
 * Phase is locked to distance travelled so stance feet do not slide.
 * See docs/BODY-MODEL.md.
 */
import type { BoneName, EulerDeg } from './types.ts';
import { clamp, clamp01 } from './math.ts';
import { flyVisualLengthMm } from '../scene/scale.ts';
import { TURN_RATE_RAD_S } from './feedingStateMachine.ts';

export const SWING_S = 0.17;
export const STRIDE_BODY_LENGTHS = 0.4;
export const STEER_STRIDE_BODY_LENGTHS = 0.05;
/** Cycle-fraction lag inside a tripod: front, then middle, then hind. */
export const TRIPOD_LEAD_CYCLE = 0.07;
export const SWING_LIFT_MM = 1.6;
export const MIN_WALK_MM_S = 1;

export const LEG_BONES = [
  'foreleg_L_tarsus',
  'foreleg_R_tarsus',
  'midleg_L',
  'midleg_R',
  'hindleg_L',
  'hindleg_R',
] as const;

export type LegBone = (typeof LEG_BONES)[number];

/** L1, R2, L3 */
export const TRIPOD_A: readonly LegBone[] = ['foreleg_L_tarsus', 'midleg_R', 'hindleg_L'];
/** R1, L2, R3 */
export const TRIPOD_B: readonly LegBone[] = ['foreleg_R_tarsus', 'midleg_L', 'hindleg_R'];

const LEAD_ORDER_A: readonly LegBone[] = ['foreleg_L_tarsus', 'midleg_R', 'hindleg_L'];
const LEAD_ORDER_B: readonly LegBone[] = ['foreleg_R_tarsus', 'midleg_L', 'hindleg_R'];

export type GaitFoot = {
  bone: LegBone;
  swing: boolean;
  /** 0–1 position inside the current swing, or 0 when in stance. */
  swingU: number;
  x: number;
  y: number;
  z: number;
  /** Anterior–posterior excursion this cycle (mm), including steering. */
  strideMm: number;
};

function wrap01(u: number): number {
  return ((u % 1) + 1) % 1;
}

export function strideMm(): number {
  return flyVisualLengthMm() * STRIDE_BODY_LENGTHS;
}

export function steerStrideMm(): number {
  return flyVisualLengthMm() * STEER_STRIDE_BODY_LENGTHS;
}

export function cycleDurationS(speedMmS: number): number {
  const v = Math.max(MIN_WALK_MM_S, speedMmS);
  return strideMm() / v;
}

export function gaitPhase(distanceMm: number): number {
  return wrap01(distanceMm / strideMm());
}

export function swingStartPhase(bone: LegBone): number {
  const inA = LEAD_ORDER_A.indexOf(bone);
  if (inA >= 0) return wrap01(inA * TRIPOD_LEAD_CYCLE);
  const inB = LEAD_ORDER_B.indexOf(bone);
  return wrap01(0.5 + inB * TRIPOD_LEAD_CYCLE);
}

export function isLeftLeg(bone: LegBone): boolean {
  return bone.endsWith('_L') || bone === 'foreleg_L_tarsus' || bone === 'midleg_L' || bone === 'hindleg_L';
}

export function isFrontLeg(bone: LegBone): boolean {
  return bone === 'foreleg_L_tarsus' || bone === 'foreleg_R_tarsus';
}

function restFoot(bone: LegBone): { x: number; y: number; z: number } {
  const left = isLeftLeg(bone) ? 1 : -1;
  if (bone === 'foreleg_L_tarsus' || bone === 'foreleg_R_tarsus') return { x: 2.4 * left, y: 0, z: 3.1 };
  if (bone === 'midleg_L' || bone === 'midleg_R') return { x: 3.3 * left, y: 0, z: 0.3 };
  return { x: 2.7 * left, y: 0, z: -3.4 };
}

function inSwing(phase: number, start: number, swingFrac: number): { swing: boolean; u: number } {
  const local = wrap01(phase - start);
  if (local < swingFrac) return { swing: true, u: swingFrac > 1e-9 ? local / swingFrac : 0 };
  return { swing: false, u: swingFrac >= 1 ? 1 : (local - swingFrac) / Math.max(1e-9, 1 - swingFrac) };
}

/**
 * Steering: +yaw (CCW, left turn) shortens left (inside) and lengthens right.
 * Magnitude scales with |yawRate| / TURN_RATE_RAD_S, capped at 5% body length.
 */
export function strideScale(bone: LegBone, yawRateRadS: number): number {
  const mag = clamp(Math.abs(yawRateRadS) / TURN_RATE_RAD_S, 0, 1);
  if (mag <= 1e-9) return 1;
  const leftInside = yawRateRadS > 0;
  const inside = isLeftLeg(bone) ? leftInside : !leftInside;
  const delta = steerStrideMm() * mag;
  const signed = inside ? -delta : delta;
  return 1 + signed / strideMm();
}

export function gaitFeet(distanceMm: number, speedMmS: number, yawRateRadS: number): GaitFoot[] {
  const speed = Math.max(0, speedMmS);
  const phase = gaitPhase(distanceMm);
  const cycle = cycleDurationS(Math.max(MIN_WALK_MM_S, speed));
  const swingFrac = clamp(SWING_S / cycle, 0.08, 0.48);
  const duty = 1 - swingFrac;
  const out: GaitFoot[] = [];
  const yawTurn = clamp(yawRateRadS / TURN_RATE_RAD_S, -1, 1);
  const frontYaw = yawTurn * 0.28;

  for (const bone of LEG_BONES) {
    const rest = restFoot(bone);
    const scale = strideScale(bone, yawRateRadS);
    const travel = strideMm() * duty * scale;
    const { swing, u } = inSwing(phase, swingStartPhase(bone), swingFrac);
    let zOff: number;
    let y = rest.y;
    if (swing) {
      zOff = -travel / 2 + u * travel;
      y = rest.y + 4 * u * (1 - u) * SWING_LIFT_MM;
    } else {
      zOff = travel / 2 - u * travel;
    }
    let x = rest.x;
    let z = rest.z + zOff;
    if (isFrontLeg(bone) && Math.abs(frontYaw) > 1e-6) {
      const cz = zOff;
      x += Math.sin(frontYaw) * cz;
      z = rest.z + Math.cos(frontYaw) * cz;
    }
    out.push({ bone, swing, swingU: swing ? u : 0, x, y, z, strideMm: travel });
  }
  return out;
}

function footToEuler(bone: LegBone, foot: GaitFoot): EulerDeg {
  const rest = restFoot(bone);
  const dZ = foot.z - rest.z;
  const dY = foot.y - rest.y;
  const dX = foot.x - rest.x;
  const lift = dY * 11;
  const ap = dZ * 5.5;
  const yaw = dX * 8;
  const left = isLeftLeg(bone);
  if (left) return [-lift - ap * 0.35, yaw, 6 + ap * 0.15];
  return [lift - ap * 0.35, yaw, -6 - ap * 0.15];
}

export function gaitPoseAtDistance(
  distanceMm: number,
  speedMmS: number,
  yawRateRadS: number,
): Partial<Record<BoneName, EulerDeg>> {
  if (speedMmS < MIN_WALK_MM_S) return {};
  const pose: Partial<Record<BoneName, EulerDeg>> = {};
  for (const foot of gaitFeet(distanceMm, speedMmS, yawRateRadS)) {
    pose[foot.bone] = footToEuler(foot.bone, foot);
  }
  return pose;
}

/** `t` is seconds; phase is locked to `speedMmS * t` (constant-speed path). */
export function gaitPose(
  t: number,
  speedMmS: number,
  yawRateRadS: number,
): Partial<Record<BoneName, EulerDeg>> {
  return gaitPoseAtDistance(Math.max(0, t) * Math.max(0, speedMmS), speedMmS, yawRateRadS);
}

export function peakSwingPhase(bone: LegBone, speedMmS: number): number {
  const cycle = cycleDurationS(speedMmS);
  const swingFrac = clamp(SWING_S / cycle, 0.08, 0.48);
  return wrap01(swingStartPhase(bone) + swingFrac / 2);
}
