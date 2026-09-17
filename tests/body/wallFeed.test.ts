import { describe, expect, it } from 'vitest';
import { UP_ALIGN_MAX_RAD, bodyUpAxis, quatFromEulerYxz, rotateByQuat } from '../../src/body/collision.ts';
import {
  NOSE_UP_SIGN,
  WALL_FEED_PITCH_RAD,
  headFrontAt,
  hindFootOffsetAt,
  pitchedHeadFrontAt,
  wallFeedLiftMm,
  wallFeedPitch,
  wallFeedStandoffMm,
  wallFeedTipMm,
} from '../../src/body/wallFeed.ts';
import {
  FLY_RENDER_SCALE,
  WALL_FEED_BITE_MM,
  bodyCollisionPadMm,
  extendedLabellumDropMm,
  extendedLabellumReachMm,
  flyVisualHalfLengthMm,
  foodStandPadMm,
  labellumRestReachMm,
  proboscisReachMm,
  standoffMm,
} from '../../src/scene/scale.ts';

describe('side-feeding posture (authored, measured reach)', () => {
  it('uses the measured proboscis reach, which is far shorter than half a body', () => {
    expect(extendedLabellumReachMm()).toBeCloseTo(4.51, 1);
    expect(extendedLabellumDropMm()).toBeCloseTo(3.0, 1);
    expect(extendedLabellumReachMm()).toBeLessThan(flyVisualHalfLengthMm());
    expect(proboscisReachMm()).toBeGreaterThan(1.5);
    expect(proboscisReachMm()).toBeCloseTo(extendedLabellumReachMm() - labellumRestReachMm(), 6);
  });

  it('pitches nose-up by 32°, inside the up-cone, with a sign derived from the director convention', () => {
    expect(WALL_FEED_PITCH_RAD).toBeLessThan(UP_ALIGN_MAX_RAD);
    const fwd = rotateByQuat(quatFromEulerYxz(wallFeedPitch(), 0, 0), { x: 0, y: 0, z: 1 });
    expect(fwd.y).toBeGreaterThan(0);
    expect(Math.abs(NOSE_UP_SIGN)).toBe(1);
    // Body up-axis still within the cone so slerpTowardUpCone leaves the posture alone.
    const up = bodyUpAxis(wallFeedPitch(), 0.7, 0);
    expect(Math.acos(up.y)).toBeLessThanOrEqual(UP_ALIGN_MAX_RAD + 1e-9);
  });

  it('puts the labellum into the wall at the standoff while the head clears it', () => {
    const tip = wallFeedTipMm();
    const standoff = standoffMm();
    expect(standoff).toBe(wallFeedStandoffMm());
    // Tip sinks 0.2–1.0 mm into the face.
    const penetration = tip.z - standoff;
    expect(penetration).toBeGreaterThanOrEqual(0.2);
    expect(penetration).toBeLessThanOrEqual(1.0);
    expect(penetration).toBeCloseTo(WALL_FEED_BITE_MM, 6);
    // Pitched tip is roughly level with the root (was 3 mm below when flat).
    expect(Math.abs(tip.y)).toBeLessThan(1);
    // Head front stays outside the wall.
    expect(pitchedHeadFrontAt(FLY_RENDER_SCALE)).toBeLessThan(standoff);
    expect(headFrontAt(FLY_RENDER_SCALE)).toBeGreaterThan(pitchedHeadFrontAt(FLY_RENDER_SCALE));
  });

  it('lifts the root so the rotation reads as about the hind feet, and keeps the food pad below the standoff', () => {
    const lift = wallFeedLiftMm();
    expect(lift).toBeGreaterThan(1);
    expect(lift).toBeLessThan(4);
    expect(lift).toBeCloseTo(hindFootOffsetAt(FLY_RENDER_SCALE) * Math.sin(WALL_FEED_PITCH_RAD), 6);
    expect(foodStandPadMm()).toBeLessThan(standoffMm());
    expect(foodStandPadMm()).toBeGreaterThan(1);
    // Generic body pad (flight, pouch, orbit) is untouched: still half a body.
    expect(bodyCollisionPadMm()).toBeCloseTo(flyVisualHalfLengthMm(), 6);
  });
});
