import { describe, expect, it } from 'vitest';
import { BIPED_BODY_PITCH_RAD, bipedPoseAtDistance, bipedStandLiftMm } from '../../src/body/bipedGait.ts';
import { cycleDurationS, gaitPoseAtDistance } from '../../src/body/gait.ts';
import { MILL_WALK_MM_S } from '../../src/scene/scale.ts';

describe('biped mill gag', () => {
  it('steps only the hind legs and holds the forelegs toward the rail', () => {
    const pose = bipedPoseAtDistance(8, MILL_WALK_MM_S);
    expect(pose.hindleg_L).toBeDefined();
    expect(pose.hindleg_R).toBeDefined();
    expect(pose.foreleg_L_tarsus).toBeDefined();
    expect(pose.foreleg_R_tarsus).toBeDefined();
    expect(BIPED_BODY_PITCH_RAD).toBeLessThan(-1);
  });

  it('is not the hexapod mill gait', () => {
    const hex = gaitPoseAtDistance(8, MILL_WALK_MM_S, 0);
    const biped = bipedPoseAtDistance(8, MILL_WALK_MM_S);
    expect(hex.midleg_L).toBeDefined();
    expect(biped.midleg_L![0]).not.toBeCloseTo(hex.midleg_L![0]!);
  });

  it('lifts the root just enough for a −78° pitch without hovering', () => {
    expect(bipedStandLiftMm()).toBeGreaterThan(1.5);
    expect(bipedStandLiftMm()).toBeLessThan(6);
  });

  it('alternates hind legs on a 1.2–1.5 s cycle at mill walk speed', () => {
    const cycle = cycleDurationS(MILL_WALK_MM_S);
    expect(cycle).toBeGreaterThan(1.2);
    expect(cycle).toBeLessThan(1.6);
    const xs = [0, 1.2, 2.4, 3.6, 4.8, 6].map((d) => bipedPoseAtDistance(d, MILL_WALK_MM_S).hindleg_L![0]!);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(4);
    const left = bipedPoseAtDistance(1.5, MILL_WALK_MM_S).hindleg_L![0]!;
    const right = bipedPoseAtDistance(1.5, MILL_WALK_MM_S).hindleg_R![0]!;
    expect(left).not.toBeCloseTo(right, 0);
  });
});
