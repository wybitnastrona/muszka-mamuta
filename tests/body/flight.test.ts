import { describe, expect, it } from 'vitest';
import {
  FOOD_HALF_SIZE_MM,
  FlightController,
  LAND_FORELEG_DEG,
  ORBIT_RADIUS_MIN,
  SACCADE_TURN_S,
  TAKEOFF_HOP_MM,
  TAKEOFF_RAISE_S,
  TAKEOFF2_TUMBLE_S,
  angularSizeDeg,
  buildSaccadePlan,
} from '../../src/body/flight.ts';
import { aabbTopY, orbitRadiusFloor, pointInAabb3, type Aabb3 } from '../../src/body/collision.ts';
import { bodyCollisionPadMm } from '../../src/scene/scale.ts';
import { Xoshiro128ss } from '../../src/brain/rng.ts';

const dt = 1 / 60;

describe('saccades', () => {
  it('alternates straight 150–600 ms with 50 ms ~90° turns', () => {
    const segs = buildSaccadePlan(new Xoshiro128ss(1), 0, 8);
    expect(segs.length).toBe(16);
    for (let i = 0; i < segs.length; i += 2) {
      expect(segs[i]!.kind).toBe('straight');
      expect(segs[i]!.duration).toBeGreaterThanOrEqual(0.15);
      expect(segs[i]!.duration).toBeLessThanOrEqual(0.6);
      expect(segs[i + 1]!.kind).toBe('turn');
      expect(segs[i + 1]!.duration).toBe(SACCADE_TURN_S);
    }
  });
});

describe('landing (van Breugel & Dickinson 2012)', () => {
  it('extends the forelegs before touchdown', () => {
    const f = new FlightController();
    f.place({ x: 80, y: 28, z: 0 }, 0);
    f.startLand({ target: { x: 0, y: 4, z: 0 }, supportY: 4, seed: 1 });
    let sawExtend = false;
    let extendedBeforeTouch = false;
    for (let i = 0; i < 1200; i++) {
      const frame = f.update(dt);
      const dist = Math.hypot(frame.position.x, frame.position.z);
      if (frame.forelegExtend > 0.5) {
        sawExtend = true;
        if (dist > 1.5 || frame.position.y > 5) extendedBeforeTouch = true;
      }
      if (frame.done) break;
    }
    expect(sawExtend).toBe(true);
    expect(extendedBeforeTouch).toBe(true);
    expect(angularSizeDeg(30)).toBeGreaterThan(LAND_FORELEG_DEG);
  });
});

describe('takeoff (Card & Dickinson 2008)', () => {
  it('type 1 raises wings before the hop', () => {
    const f = new FlightController();
    f.place({ x: 0, y: 2, z: 0 }, 0);
    f.startTakeoff1();
    let raiseBeforeHop = false;
    for (let i = 0; i < 80; i++) {
      const t = i * dt;
      const frame = f.update(dt);
      if (t < TAKEOFF_RAISE_S - 1e-4) {
        expect(frame.position.y).toBeCloseTo(2, 5);
        if (frame.wingRaise > 0.4) raiseBeforeHop = true;
      }
      if (frame.hopPeakMm > 1) {
        expect(raiseBeforeHop).toBe(true);
        expect(frame.hopPeakMm).toBeLessThanOrEqual(TAKEOFF_HOP_MM + 0.2);
        break;
      }
    }
    expect(raiseBeforeHop).toBe(true);
  });

  it('type 2 hops with wings folded then tumbles', () => {
    const f = new FlightController();
    f.place({ x: 30, y: 4, z: 0 }, 0);
    f.startTakeoff2({ x: 0, y: 4, z: 0 });
    let foldedHop = false;
    let tumbled = false;
    for (let i = 0; i < 200; i++) {
      const frame = f.update(dt);
      if (frame.hopPeakMm > 1 && frame.wingRaise < 0.2) foldedHop = true;
      if (Math.abs(frame.roll) > Math.PI) tumbled = true;
      if (frame.done) {
        expect(i * dt).toBeLessThanOrEqual(1.55);
        break;
      }
    }
    expect(foldedHop).toBe(true);
    expect(tumbled).toBe(true);
    void TAKEOFF2_TUMBLE_S;
  });
});

const FOOD_BOX: Aabb3 = { cx: 0, cy: 15, cz: 0, hx: 40, hy: 15, hz: 50 };

describe('flight vs solids', () => {
  it('never intersects the block AABB on 200 random paths', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = new Xoshiro128ss(seed + 11);
      const f = new FlightController();
      f.setWorld({ obstacles: [FOOD_BOX], floorY: 2, ceilingY: 220 });
      const r = 70 + rng.nextFloat() * 50;
      const a = rng.nextFloat() * Math.PI * 2;
      const y = 18 + rng.nextFloat() * 20;
      f.place({ x: Math.sin(a) * r, y, z: Math.cos(a) * r }, a + Math.PI / 2);
      const kind = seed % 4;
      if (kind === 0) f.startOrbit({ target: { x: 0, y: 15, z: 0 }, circuits: 1, seed, radius: r });
      else if (kind === 1) f.startLand({ target: { x: 0, y: 2, z: 0 }, supportY: 2, seed });
      else if (kind === 2) f.startExit(a + Math.PI / 2);
      else f.startTakeoff1();
      for (let i = 0; i < 500; i++) {
        const frame = f.update(dt);
        expect(pointInAabb3(frame.position, FOOD_BOX, -0.05), `seed ${seed} @${i}`).toBe(false);
        if (frame.done) break;
      }
    }
  });

  it('orbits outside the block diagonal instead of scraping the edge', () => {
    // Regression: ORBIT_RADIUS_MIN (60) sits inside the 64 mm XZ diagonal of
    // the 80 × 100 block, so a descending orbit was resolved onto a side face
    // every frame and the fly "flew along the edge".
    const f = new FlightController();
    f.setWorld({ obstacles: [FOOD_BOX], floorY: 2, ceilingY: 220 });
    f.place({ x: 0, y: 28, z: 60 }, Math.PI / 2);
    f.startOrbit({ target: { x: 0, y: 15, z: 0 }, circuits: 3, seed: 7, radius: ORBIT_RADIUS_MIN, descend: true });
    const floor = f.orbitFloor();
    expect(floor).toBeGreaterThan(Math.hypot(FOOD_BOX.hx, FOOD_BOX.hz));
    expect(floor).toBeGreaterThanOrEqual(orbitRadiusFloor(FOOD_BOX, bodyCollisionPadMm(), 0));
    let hits = 0;
    let steps = 0;
    for (let i = 0; i < 2400; i++) {
      const frame = f.update(dt);
      steps++;
      const r = Math.hypot(frame.position.x, frame.position.z);
      expect(r, `radius @${i}`).toBeGreaterThanOrEqual(floor - 1e-6);
      expect(pointInAabb3(frame.position, FOOD_BOX, bodyCollisionPadMm() - 0.5), `pad @${i}`).toBe(false);
      if (f.hitCount > 0) hits++;
      if (frame.done) break;
    }
    expect(steps).toBeGreaterThan(60);
    expect(hits).toBe(0);
  });

  it('derives the food half-size from the real block', () => {
    expect(FOOD_HALF_SIZE_MM).toBe(55);
  });

  it('follows an authored spline into a solid when ghosting', () => {
    const f = new FlightController();
    f.setWorld({ obstacles: [FOOD_BOX], floorY: 2, ceilingY: 220 });
    f.place({ x: 80, y: 28, z: 0 }, Math.PI);
    f.startSpline({
      points: [
        { x: 80, y: 28, z: 0 },
        { x: 40, y: 40, z: 0 },
        { x: 0, y: 20, z: 0 },
        { x: 0, y: 10, z: 0 },
      ],
      duration: 1,
    });
    let inside = false;
    for (let i = 0; i < 90; i++) {
      const frame = f.update(dt);
      if (pointInAabb3(frame.position, FOOD_BOX, -0.05)) inside = true;
      if (frame.done) {
        expect(frame.kind).toBe('spline');
        expect(frame.position.y).toBeCloseTo(10, 0);
        break;
      }
    }
    expect(inside).toBe(true);
  });

  it('clamps landing targets to at or above local support', () => {
    const f = new FlightController();
    f.setWorld({ obstacles: [FOOD_BOX], floorY: 2 });
    f.place({ x: 80, y: 28, z: 0 }, Math.PI);
    f.startLand({ target: { x: 0, y: 2, z: 0 }, supportY: 2, seed: 3 });
    for (let i = 0; i < 1200; i++) {
      const frame = f.update(dt);
      expect(frame.position.y).toBeGreaterThanOrEqual(1.4);
      if (Math.abs(frame.position.x) <= FOOD_BOX.hx && Math.abs(frame.position.z) <= FOOD_BOX.hz) {
        expect(frame.position.y).toBeGreaterThanOrEqual(aabbTopY(FOOD_BOX) - 0.7);
      }
      expect(pointInAabb3(frame.position, FOOD_BOX, -0.05)).toBe(false);
      if (frame.done) break;
    }
  });
});
