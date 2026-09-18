/**
 * Authored two-leg gag on the mill. Not Drosophila literature — mid/hind
 * bones are procedural. Forelegs reach the front console lean-bar; hindleg_L /
 * hindleg_R step on the belt. Pitch is near-vertical (gag).
 */
import type { BoneName, EulerDeg } from './types.ts';
import { gaitFeet, MIN_WALK_MM_S, strideMm } from './gait.ts';
import { flyVisualLengthMm, flyVisualHalfLengthMm } from '../scene/scale.ts';
import { millConsoleGripWorld, millStandXz, millSurfaceY } from './treadmill.ts';

/** Near-upright torso so the fly can hold the mill rail. Authored gag, not anatomy. */
export const BIPED_BODY_PITCH_RAD = (-78 * Math.PI) / 180;
export const BIPED_WALK_S = 25;
/** Belt biped dwell. Authored 20–30 s then AUTONOMOUS. */
export const MILL_WALK_S = 25;

/**
 * Small extra root Y so a −78° pitch clears the abdomen without lifting
 * the tarsi off the belt. Hexapod landing uses no lift.
 */
export function bipedStandLiftMm(): number {
  return flyVisualHalfLengthMm() * Math.abs(Math.sin(BIPED_BODY_PITCH_RAD)) * 0.32;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Foreleg Euler scaled by the stand→lean-bar reach. Not an IK solver —
 * Flybody has no IK; this is an authored gag parameterised by millConsoleGripWorld.
 */
export function millConsoleReachPose(
  grip = millConsoleGripWorld(),
  stand = millStandXz(),
): Partial<Record<BoneName, EulerDeg>> {
  const beltY = millSurfaceY(stand.x);
  const midX = (grip.left.x + grip.right.x) / 2;
  const midY = (grip.left.y + grip.right.y) / 2;
  const reach = Math.hypot(midX - stand.x, midY - beltY);
  const k = clamp(reach / flyVisualLengthMm(), 0.35, 1.15);
  const curl = 28 * k;
  return {
    foreleg_L_tarsus: [-curl, 14, 38],
    foreleg_R_tarsus: [-curl, -14, -38],
    midleg_L: [18, 10, 14],
    midleg_R: [-18, -10, -14],
    hindleg_L: [22, 8, 10],
    hindleg_R: [-22, -8, -10],
  };
}

/** @deprecated Alias of millConsoleReachPose. */
export function millRailReachPose(): Partial<Record<BoneName, EulerDeg>> {
  return millConsoleReachPose();
}

export function bipedPoseAtDistance(
  distanceMm: number,
  speedMmS: number,
): Partial<Record<BoneName, EulerDeg>> {
  const rest = millConsoleReachPose();
  if (speedMmS < MIN_WALK_MM_S) return rest;
  const pose: Partial<Record<BoneName, EulerDeg>> = { ...rest };
  for (const foot of gaitFeet(distanceMm, speedMmS, 0)) {
    if (foot.bone === 'midleg_L' || foot.bone === 'midleg_R') {
      const plant = foot.y * 4;
      if (foot.bone === 'midleg_L') {
        const base = rest.midleg_L!;
        pose.midleg_L = [base[0]! - plant, base[1]!, base[2]!];
      } else {
        const base = rest.midleg_R!;
        pose.midleg_R = [base[0]! + plant, base[1]!, base[2]!];
      }
      continue;
    }
    if (foot.bone !== 'hindleg_L' && foot.bone !== 'hindleg_R') continue;
    const lift = foot.y * 14;
    const ap = (foot.z + 3.4) * 8;
    if (foot.bone === 'hindleg_L') {
      const base = rest.hindleg_L!;
      pose.hindleg_L = [base[0]! - lift, base[1]!, base[2]! + ap * 0.35];
    } else {
      const base = rest.hindleg_R!;
      pose.hindleg_R = [base[0]! + lift, base[1]!, base[2]! - ap * 0.35];
    }
  }
  return pose;
}

export function bipedCycleMm(): number {
  return strideMm();
}
