import { describe, expect, it } from 'vitest';
import {
  UP_ALIGN_MAX_RAD,
  aabbTopY,
  bodyUpAxis,
  clampLandTarget,
  pointInAabb3,
  resolveAabb3,
  slerpTowardUpCone,
  tiltFromNormal,
  type Aabb3,
} from '../../src/body/collision.ts';

const food: Aabb3 = { cx: 0, cy: 15, cz: 0, hx: 40, hy: 15, hz: 50 };

describe('3D exclusion', () => {
  it('never pushes a centre out the bottom of the twaróg', () => {
    const inside = { x: 0, y: 2, z: 0 };
    const out = resolveAabb3(inside, { x: 0, y: 0, z: 0 }, food);
    expect(out.hit).toBe(true);
    expect(out.position.y).toBeGreaterThanOrEqual(aabbTopY(food));
    expect(pointInAabb3(out.position, food, -0.01)).toBe(false);
    expect(out.ny).toBeGreaterThan(0);
  });

  it('slides velocity along the face instead of zeroing it', () => {
    const p = { x: 39, y: 15, z: 0 };
    const v = { x: -20, y: 4, z: 8 };
    const out = resolveAabb3(p, v, food);
    expect(out.hit).toBe(true);
    expect(Math.hypot(out.velocity.x, out.velocity.y, out.velocity.z)).toBeGreaterThan(4);
    expect(out.velocity.x * out.nx + out.velocity.y * out.ny + out.velocity.z * out.nz).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe('landing targets', () => {
  it('are at or above local support and never under a solid', () => {
    const under = clampLandTarget({ x: 0, y: 2, z: 0 }, 2, [food]);
    expect(under.y).toBeGreaterThanOrEqual(aabbTopY(food));
    expect(under.y).toBeGreaterThanOrEqual(2);
    const side = clampLandTarget({ x: 80, y: 2, z: 0 }, 2, [food]);
    expect(side.y).toBeGreaterThanOrEqual(2);
    expect(pointInAabb3({ x: side.x, y: side.y, z: side.z }, food, -0.01)).toBe(false);
  });
});

describe('up-vector cone', () => {
  it('rests within 35° of +Y and slerps a 90° pitch back', () => {
    const n = { x: 0, y: 1, z: 0 };
    const rest = bodyUpAxis(0, 0, 0);
    expect(tiltFromNormal(rest, n)).toBeLessThan(0.05);
    let pitch = Math.PI / 2;
    let roll = 0;
    for (let i = 0; i < 24; i++) {
      const next = slerpTowardUpCone(pitch, 0, roll, n, 1 / 60);
      pitch = next.pitch;
      roll = next.roll;
    }
    const up = bodyUpAxis(pitch, 0, roll);
    expect(tiltFromNormal(up, n)).toBeLessThanOrEqual(UP_ALIGN_MAX_RAD + 0.05);
  });
});
