import { describe, expect, it } from 'vitest';
import {
  UP_ALIGN_MAX_RAD,
  aabbTopY,
  bodyUpAxis,
  clampLandTarget,
  orbitRadiusFloor,
  pointInAabb3,
  resolveAabb3,
  resolveSolids,
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

  it('keeps the previous face near an edge (hysteresis) unless another is far closer', () => {
    // 1.0 mm from +X face, 0.9 mm from +Z face: nearest is +Z.
    const p = { x: 39, y: 15, z: 49.1 };
    const v = { x: 0, y: 0, z: 0 };
    const nearest = resolveAabb3(p, v, food);
    expect(nearest.nz).toBe(1);
    const sticky = resolveAabb3(p, v, food, 0, { nx: 1, ny: 0, nz: 0 });
    expect(sticky.nx).toBe(1);
    // 3 mm from +X but 0.5 mm from +Z: the preferred face loses.
    const far = resolveAabb3({ x: 37, y: 15, z: 49.5 }, v, food, 0, { nx: 1, ny: 0, nz: 0 });
    expect(far.nz).toBe(1);
  });

  it('never flips faces frame to frame while gliding along an edge', () => {
    let prefer: { nx: number; ny: number; nz: number } | null = null;
    let flips = 0;
    // Glide along the +X/+Z edge, staying marginally inside both faces
    // (distances 0.7–0.9 mm, i.e. within the 25% hysteresis band).
    for (let i = 0; i < 120; i++) {
      const jitter = Math.sin(i * 0.9) * 0.1;
      const p = { x: 39.2 + jitter, y: 15, z: 49.2 - jitter };
      const out = resolveSolids(p, { x: 0, y: 0, z: -30 }, [food], [], 0, prefer);
      expect(out.hit).toBe(true);
      if (prefer && out.normal && (out.normal.nx !== prefer.nx || out.normal.nz !== prefer.nz)) flips++;
      prefer = out.normal;
    }
    expect(flips).toBeLessThanOrEqual(2);
  });

  it('orbit floor clears the box diagonal plus body pad and clearance', () => {
    expect(orbitRadiusFloor(food, 5, 8)).toBeCloseTo(Math.hypot(40, 50) + 13, 6);
    expect(orbitRadiusFloor(food, 0, 0)).toBeGreaterThan(60);
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
