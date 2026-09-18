import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KITCHEN_FRAMING, kitchenFrame } from '../../src/body/cameras.ts';
import { CreatineSystem } from '../../src/food/creatineSystem.ts';
import {
  createDumbbell,
  createGymProps,
  gymDumbbellStackFootprintMm,
} from '../../src/scene/gymProps.ts';
import {
  BENCH_YAW_RAD,
  GYM_GAP_MM,
  gymClearancesMm,
  gymMatTopY,
  kitchenLayout,
  pointInGymMat,
} from '../../src/scene/layout.ts';
import { BENCH_MM, DUMBBELL_MM, MAT_MM, MILL_MM, mm } from '../../src/scene/scale.ts';

describe('gym corner', () => {
  it('keeps mill/tub/mat/bench footprints clear of each other', () => {
    const { mill, tub, mat, bench, dumbbells } = kitchenLayout();
    const gap = gymClearancesMm();
    expect(GYM_GAP_MM).toBe(12);
    expect(gap.millToMatZ).toBeCloseTo(GYM_GAP_MM, 5);
    expect(gap.millToMatX).toBeCloseTo(GYM_GAP_MM, 5);
    expect(gap.matToBenchX).toBeCloseTo(GYM_GAP_MM, 4);
    expect(gap.tubRimToMat).toBeGreaterThan(20);
    expect(gap.millToBench).toBeGreaterThan(4);
    expect(mat.z).toBeGreaterThan(mill.z + mill.hz);
    expect(mat.x).toBeGreaterThan(mill.x + mill.hx);
    expect(bench.x).toBeGreaterThan(mat.x + mat.hx);
    expect(bench.yaw).toBeCloseTo(BENCH_YAW_RAD, 8);
    expect(Math.abs(bench.yaw - 0) * 180 / Math.PI).toBeCloseTo(15, 5);
    expect(bench.topY).toBeCloseTo(mm(BENCH_MM.height), 5);
    expect(Math.abs(bench.topY - (mm(MILL_MM.deck) + 4.2))).toBeLessThan(1);
    expect(dumbbells).toHaveLength(4);
    for (const d of dumbbells) {
      expect(d.length).toBe(mm(DUMBBELL_MM.length));
      expect(pointInGymMat(d.x, d.z)).toBe(true);
    }
    expect(tub.x + tub.diameter / 2).toBeLessThan(mat.x - mat.hx);
  });

  it('stacks four dumbbells in a 3+1 pyramid with seeded yaw jitter', () => {
    const { dumbbells } = kitchenLayout();
    const yaws = dumbbells.map((d) => d.yaw);
    const unique = new Set(yaws.map((y) => y.toFixed(4)));
    expect(unique.size).toBe(4);
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(0.04);
    const bottom = dumbbells.slice(0, 3);
    const top = dumbbells[3]!;
    expect(top.y).toBeGreaterThan(Math.max(...bottom.map((d) => d.y)));
    const foot = gymDumbbellStackFootprintMm();
    expect(foot.length).toBeGreaterThan(mm(DUMBBELL_MM.length) - 2);
    expect(foot.length).toBeLessThan(mm(MAT_MM.length));
    expect(foot.width).toBeGreaterThan(mm(DUMBBELL_MM.plateRadius) * 4);
    expect(foot.width).toBeLessThan(mm(MAT_MM.width));
  });

  it('builds primitive meshes that cast and receive shadows', () => {
    const gym = createGymProps();
    const names: string[] = [];
    gym.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        names.push(obj.name);
        expect(obj.castShadow).toBe(true);
        expect(obj.receiveShadow).toBe(true);
      }
    });
    expect(names).toContain('gymMat');
    expect(names).toContain('gymBenchPad');
    expect(gym.group.getObjectByName('gymDumbbell0')).toBeTruthy();
    expect(gym.group.getObjectByName('gymDumbbell3')).toBeTruthy();
    const db = createDumbbell(mm(DUMBBELL_MM.length), mm(DUMBBELL_MM.plateRadius));
    expect(db.children.length).toBe(3);
    gym.dispose();
    db.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  });

  it('registers the mat as walkable support', () => {
    const { mat, pile } = kitchenLayout();
    expect(pointInGymMat(mat.x, mat.z)).toBe(true);
    expect(pointInGymMat(pile.x, pile.z)).toBe(false);
    expect(gymMatTopY()).toBeCloseTo(mm(MAT_MM.thickness), 5);
    const sys = CreatineSystem.create({ seed: 1, store: null });
    expect(sys.supportHeightAt(mat.x, mat.z, { x: pile.x, y: pile.y, z: pile.z })).toBeCloseTo(gymMatTopY(), 5);
  });

  it('pulls Widok kuchni back so tub + mill + gym fit (KITCHEN_FRAMING 0.95 → 1.28)', () => {
    expect(KITCHEN_FRAMING).toBeCloseTo(1.28);
    const { tub, mill, mat, bench } = kitchenLayout();
    const frame = kitchenFrame();
    expect(frame.lookAt[0]).toBeGreaterThan(tub.x);
    expect(frame.lookAt[0]).toBeLessThan(bench.x);
    expect(frame.position[2]).toBeLessThan(frame.lookAt[2] - 300);
    const dist = Math.hypot(
      frame.position[0] - frame.lookAt[0],
      frame.position[1] - frame.lookAt[1],
      frame.position[2] - frame.lookAt[2],
    );
    const span = 2 * dist * Math.tan((frame.fov * Math.PI) / 360);
    expect(span).toBeGreaterThan((bench.x + bench.hx) - (tub.x - tub.diameter / 2) * 0.35);
    expect(mat.z).toBeGreaterThan(mill.z);
  });
});
