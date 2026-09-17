/**
 * Authored two-leg gag on the mill. Not Drosophila literature — mid/hind
 * bones are procedural. Forelegs stay up; only hindleg_L / hindleg_R step.
 */
import type { BoneName, EulerDeg } from './types.ts';
import { gaitFeet, MIN_WALK_MM_S, strideMm } from './gait.ts';

export const BIPED_BODY_PITCH_RAD = 0.48;
export const BIPED_WALK_S = 6;
export const MILL_WALK_S = 8;

export function bipedPoseAtDistance(
  distanceMm: number,
  speedMmS: number,
): Partial<Record<BoneName, EulerDeg>> {
  if (speedMmS < MIN_WALK_MM_S) return {};
  const pose: Partial<Record<BoneName, EulerDeg>> = {
    foreleg_L_tarsus: [42, 8, 22],
    foreleg_R_tarsus: [42, -8, -22],
    midleg_L: [18, 6, 10],
    midleg_R: [-18, -6, -10],
  };
  for (const foot of gaitFeet(distanceMm, speedMmS, 0)) {
    if (foot.bone !== 'hindleg_L' && foot.bone !== 'hindleg_R') continue;
    const lift = foot.y * 14;
    const ap = (foot.z + 3.4) * 6;
    if (foot.bone === 'hindleg_L') pose.hindleg_L = [-lift - ap * 0.4, 4, 10 + ap * 0.2];
    else pose.hindleg_R = [lift - ap * 0.4, -4, -10 - ap * 0.2];
  }
  return pose;
}

export function bipedCycleMm(): number {
  return strideMm();
}
