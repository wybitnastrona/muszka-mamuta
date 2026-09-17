import { describe, expect, it } from 'vitest';
import { bipedPoseAtDistance, BIPED_BODY_PITCH_RAD } from '../../src/body/bipedGait.ts';
import { gaitPoseAtDistance } from '../../src/body/gait.ts';

describe('biped mill gag', () => {
  it('steps only the hind legs and holds the forelegs up', () => {
    const pose = bipedPoseAtDistance(8, 14);
    expect(pose.hindleg_L).toBeDefined();
    expect(pose.hindleg_R).toBeDefined();
    expect(pose.foreleg_L_tarsus![0]).toBeGreaterThan(20);
    expect(pose.foreleg_R_tarsus![0]).toBeGreaterThan(20);
    expect(BIPED_BODY_PITCH_RAD).toBeGreaterThan(0.3);
  });

  it('is not the hexapod mill gait', () => {
    const hex = gaitPoseAtDistance(8, 14, 0);
    const biped = bipedPoseAtDistance(8, 14);
    expect(hex.midleg_L).toBeDefined();
    expect(biped.midleg_L![0]).not.toBeCloseTo(hex.midleg_L![0]!);
  });
});
