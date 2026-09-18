import { describe, expect, it } from 'vitest';
import { millGaitAdvance } from '../../src/body/gait.ts';
import { millBeltScroll, millBeltChevron, millBeltLengthMm, millConsoleLabel, millConsoleLocalPose, millConsoleGripWorld, millStandXz, MILL_BELT_SPAN, MILL_HEADING, MILL_INCLINE_RAD } from '../../src/body/treadmill.ts';
import { scoopBowlLocal } from '../../src/body/scoop.ts';
import { MILL_WALK_MM_S } from '../../src/scene/scale.ts';

describe('mill belt + gait', () => {
  it('advances gait distance from belt speed with a stationary root', () => {
    const dt = 1 / 30;
    let d = 0;
    for (let i = 0; i < 30; i++) d = millGaitAdvance(d, MILL_WALK_MM_S, dt);
    expect(d).toBeCloseTo(MILL_WALK_MM_S, 5);
  });

  it('scrolls belt UV by speed / belt length', () => {
    const dt = 0.5;
    const belt = millBeltLengthMm();
    const next = millBeltScroll(0, dt);
    expect(next).toBeCloseTo(1 - (MILL_WALK_MM_S / belt) * dt);
    expect(MILL_BELT_SPAN).toBeLessThan(0.7);
    expect(millConsoleLabel(0)).toBe('0.00 km');
    expect(millConsoleLabel(MILL_WALK_MM_S * dt)).toBe('0.00 km');
    expect(millConsoleLabel(1250)).toBe('1.25 km');
  });

  it('paints chunky high-contrast chevrons, not sub-millimetre noise', () => {
    expect(millBeltChevron(0.05, 0.5)).not.toBe(millBeltChevron(0.22, 0.5));
    let flips = 0;
    let last = millBeltChevron(0, 0.5);
    for (let i = 1; i <= 30; i++) {
      const on = millBeltChevron(i / 30, 0.5);
      if (on !== last) flips += 1;
      last = on;
    }
    expect(flips).toBeGreaterThanOrEqual(4);
    expect(flips).toBeLessThanOrEqual(8);
  });

  it('pitches the pad uphill toward the +X console at 3.50°', () => {
    expect(MILL_INCLINE_RAD).toBeCloseTo(0.0611, 4);
    expect((MILL_INCLINE_RAD * 180) / Math.PI).toBeCloseTo(3.5, 1);
    expect(MILL_INCLINE_RAD).toBeGreaterThan(0.05);
    expect(MILL_INCLINE_RAD).toBeLessThan(0.2);
  });

  it('puts the front lean-bar on +X with left/right grips', () => {
    const stand = millStandXz();
    const grip = millConsoleGripWorld();
    expect(MILL_HEADING).toBeCloseTo(Math.PI / 2);
    expect(grip.left.x).toBeGreaterThan(stand.x);
    expect(grip.right.x).toBe(grip.left.x);
    expect(grip.left.z).toBeGreaterThan(grip.right.z);
  });

  it('puts a back-tilted LED on the front console, camera-facing', () => {
    const pose = millConsoleLocalPose();
    expect(pose.rotY).toBeCloseTo(Math.PI);
    expect(pose.rotX).toBeLessThan(0);
    expect(pose.x).toBeGreaterThan(0);
    expect(pose.z).toBeLessThan(0);
    expect(pose.width).toBeGreaterThan(pose.depth);
  });
});

describe('scoop', () => {
  it('puts the bowl ahead of the grip so the labellum can reach powder', () => {
    const bowl = scoopBowlLocal();
    expect(bowl.z).toBeGreaterThan(4);
    expect(Math.abs(bowl.x)).toBeLessThan(1);
  });
});
