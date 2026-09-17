import { describe, expect, it } from 'vitest';
import { millGaitAdvance } from '../../src/body/gait.ts';
import { millBeltScroll } from '../../src/body/treadmill.ts';
import { scoopBowlLocal } from '../../src/body/scoop.ts';
import { FLY_WALK_MM_S, MILL_MM } from '../../src/scene/scale.ts';

describe('mill belt + gait', () => {
  it('advances gait distance from belt speed with a stationary root', () => {
    const dt = 1 / 30;
    let d = 0;
    for (let i = 0; i < 30; i++) d = millGaitAdvance(d, FLY_WALK_MM_S, dt);
    expect(d).toBeCloseTo(FLY_WALK_MM_S, 5);
  });

  it('scrolls belt UV by speed / belt length', () => {
    const dt = 0.5;
    const belt = MILL_MM.length * 0.78;
    const next = millBeltScroll(0, dt);
    expect(next).toBeCloseTo((FLY_WALK_MM_S / belt) * dt);
  });
});

describe('scoop', () => {
  it('puts the bowl ahead of the grip so the labellum can reach powder', () => {
    const bowl = scoopBowlLocal();
    expect(bowl.z).toBeGreaterThan(4);
    expect(Math.abs(bowl.x)).toBeLessThan(1);
  });
});
