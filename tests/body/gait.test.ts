import { describe, expect, it } from 'vitest';
import {
  LEG_BONES,
  MIN_WALK_MM_S,
  SWING_S,
  TRIPOD_A,
  TRIPOD_B,
  gaitFeet,
  gaitPhase,
  gaitPose,
  isFrontLeg,
  isLeftLeg,
  peakSwingPhase,
  strideMm,
  strideScale,
} from '../../src/body/gait.ts';
import { TURN_RATE_RAD_S } from '../../src/body/feedingStateMachine.ts';
import { flyVisualLengthMm } from '../../src/scene/scale.ts';

const SPEEDS = [7, 14, 21] as const;
const DT = 1 / 60;

function byBone(distance: number, speed: number, yaw: number) {
  return Object.fromEntries(gaitFeet(distance, speed, yaw).map((f) => [f.bone, f]));
}

describe('M-tripod gait', () => {
  it('keeps tripod grouping at three speeds', () => {
    for (const speed of SPEEDS) {
      const peak = peakSwingPhase('foreleg_L_tarsus', speed);
      const feet = byBone(peak * strideMm(), speed, 0);
      const aSwing = TRIPOD_A.filter((b) => feet[b]!.swing).length;
      const bSwing = TRIPOD_B.filter((b) => feet[b]!.swing).length;
      expect(aSwing).toBeGreaterThan(bSwing);
      expect(feet.foreleg_L_tarsus!.swing).toBe(true);
      expect(feet.foreleg_R_tarsus!.swing).toBe(false);
      const peakB = peakSwingPhase('foreleg_R_tarsus', speed);
      const feetB = byBone(peakB * strideMm(), speed, 0);
      expect(TRIPOD_B.filter((b) => feetB[b]!.swing).length).toBeGreaterThan(
        TRIPOD_A.filter((b) => feetB[b]!.swing).length,
      );
    }
  });

  it('has front lead middle lead hind within a tripod', () => {
    for (const speed of SPEEDS) {
      const a = ['foreleg_L_tarsus', 'midleg_R', 'hindleg_L'] as const;
      const peaks = a.map((bone) => peakSwingPhase(bone, speed));
      expect(peaks[0]).toBeLessThan(peaks[1]);
      expect(peaks[1]).toBeLessThan(peaks[2]);
      const b = ['foreleg_R_tarsus', 'midleg_L', 'hindleg_R'] as const;
      const peaksB = b.map((bone) => peakSwingPhase(bone, speed));
      expect(peaksB[0]).toBeLessThan(peaksB[1]);
      expect(peaksB[1]).toBeLessThan(peaksB[2]);
    }
  });

  it('lengthens outside strides and shortens inside strides in a turn', () => {
    const yaw = TURN_RATE_RAD_S;
    const feet = gaitFeet(0, 14, yaw);
    const left = feet.filter((f) => isLeftLeg(f.bone)).map((f) => f.strideMm);
    const right = feet.filter((f) => !isLeftLeg(f.bone)).map((f) => f.strideMm);
    expect(Math.min(...right)).toBeGreaterThan(Math.max(...left));
    expect(strideScale('foreleg_R_tarsus', yaw)).toBeGreaterThan(strideScale('foreleg_L_tarsus', yaw));
    // Front-leg step direction rotates into the turn. The lateral offset is
    // proportional to the foot's fore–aft excursion, so sample the whole
    // cycle rather than one phase (mid-stance has zero excursion).
    let maxDx = 0;
    for (let k = 0; k < 10; k++) {
      const d = strideMm() * (k / 10);
      const frontL0 = gaitFeet(d, 14, 0).find((f) => f.bone === 'foreleg_L_tarsus')!;
      const frontL1 = gaitFeet(d, 14, yaw).find((f) => f.bone === 'foreleg_L_tarsus')!;
      maxDx = Math.max(maxDx, Math.abs(frontL1.x - frontL0.x));
    }
    expect(maxDx).toBeGreaterThan(0.01);
  });

  it('does not slide stance feet more than 0.2 mm per frame', () => {
    const speed = 14;
    let distance = 0;
    let bodyZ = 0;
    const prev = new Map<string, { z: number; swing: boolean }>();
    for (let i = 0; i < 240; i++) {
      distance += speed * DT;
      bodyZ += speed * DT;
      expect(gaitPhase(distance)).toBeGreaterThanOrEqual(0);
      for (const foot of gaitFeet(distance, speed, 0)) {
        const worldZ = bodyZ + foot.z;
        const last = prev.get(foot.bone);
        if (last && !last.swing && !foot.swing) {
          expect(Math.abs(worldZ - last.z), foot.bone).toBeLessThanOrEqual(0.2);
        }
        prev.set(foot.bone, { z: worldZ, swing: foot.swing });
      }
    }
  });

  it('exposes euler for all six legs and holds swing duration constant', () => {
    const pose = gaitPose(0.4, 14, 0);
    for (const bone of LEG_BONES) expect(pose[bone]).toBeDefined();
    expect(SWING_S).toBeCloseTo(0.17);
    expect(strideMm()).toBeCloseTo(flyVisualLengthMm() * 0.4);
    expect(gaitPose(0, MIN_WALK_MM_S - 0.5, 0)).toEqual({});
    expect(isFrontLeg('foreleg_L_tarsus')).toBe(true);
    expect(isLeftLeg('midleg_L')).toBe(true);
  });
});
