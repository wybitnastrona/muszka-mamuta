import { describe, expect, it } from 'vitest';
import { fractureCurdBlock } from '../../src/food/proceduralTwarog.ts';
import { TWAROG_MAMUTA_WANILIOWY } from '../../src/food/foodProfile.ts';
import {
  CONTACT_RADIUS_BODY_LENGTHS,
  CRUMB_MAX,
  CRUMB_MIN,
  ETERNITY_MASS_FRAC,
  PUMP_PERIOD_S,
  REFILL_ANIM_S,
  TwarogSystem,
  contactRadiusMm,
  contactToGustRates,
  loadPortionCount,
  pointInXzAabb,
  sampleChemo,
  sampleContactFields,
  savePortionCount,
  type ChunkRecord,
  type KvStore,
  type TwarogStepInput,
  type Vec3,
} from '../../src/food/twarogSystem.ts';
import {
  CURD_BITE_MM,
  CURD_MM,
  CURD_TOTAL_MASS_G,
  LOD_BODY_LENGTHS,
  LOD_FADE_MS,
  boardTopY,
  tableTopY,
  contactRadiusMm as scaleContactRadiusMm,
  flyVisualLengthMm,
  labellumRestReachMm,
  lodDistanceMm,
  lodFadeSec,
  mm,
} from '../../src/scene/scale.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';

class MemoryStore implements KvStore {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function chunks(n: number, total = CURD_TOTAL_MASS_G): ChunkRecord[] {
  const massGrams = total / n;
  return Array.from({ length: n }, (_, index) => ({
    index,
    centroid: { x: index * 3, y: 5, z: 0 },
    massGrams,
    biteDistance: index,
    neighbours: index > 0 ? [index - 1] : index < n - 1 ? [index + 1] : [],
    eaten: false,
  }));
}

function input(over: Partial<TwarogStepInput> & { labellum: Vec3 }): TwarogStepInput {
  return {
    dt: 1 / 60,
    pumping: false,
    cameraDist: lodDistanceMm() + 80,
    sensors: [over.labellum],
    foodXZ: { x: 0, z: 0 },
    flyXZ: { x: 40, z: 40 },
    profile: TWAROG_MAMUTA_WANILIOWY,
    ...over,
  };
}

describe('twarog system', () => {
  it('renormalizes fractured chunks so consuming all of them equals 250 g', () => {
    const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
    expect(sys.chunkCount).toBeGreaterThan(1);
    expect(sys.totalMassGrams).toBeCloseTo(CURD_TOTAL_MASS_G, 5);
    // The opening bite is already gone when the portion is served.
    expect(sys.openingBiteIndices.length).toBeGreaterThan(0);
    expect(sys.portionMassGrams).toBeLessThan(CURD_TOTAL_MASS_G);
    expect(sys.remainingMassGrams).toBeCloseTo(sys.portionMassGrams, 5);
    let ingested = 0;
    for (const chunk of sys.chunks) ingested += sys.commitChunk(chunk.index);
    expect(ingested).toBeCloseTo(sys.portionMassGrams, 5);
    expect(sys.remainingMassGrams).toBe(0);
    expect(sys.uneatenCount).toBe(0);
  });

  it('serves every portion with a walkable opening-bite crater at the anchored corner', () => {
    const fractured = fractureCurdBlock({ seed: 1 });
    const sys = TwarogSystem.fromFracture(fractured, { store: null });
    const origin = { x: 0, y: boardTopY() + mm(CURD_MM.height) / 2, z: 0 };
    const anchor = sys.biteAnchor!;
    expect(anchor.x).toBeCloseTo(sys.hx * CURD_BITE_MM.anchorFracX);
    expect(anchor.z).toBeCloseTo(sys.hz * CURD_BITE_MM.anchorFracZ);
    // Bite front (where eating starts) sits in the crater column.
    expect(sys.biteFront.x).toBeCloseTo(anchor.x);
    expect(sys.biteFront.z).toBeCloseTo(anchor.z);
    expect(sys.lastBiteFront).toEqual(anchor);
    // Only crater cells are eaten, and the block is still "pristine" for approach bounds.
    const eaten = sys.chunks.filter((c) => c.eaten).map((c) => c.index).sort((a, b) => a - b);
    expect(eaten).toEqual([...fractured.openingBite].sort((a, b) => a - b));
    expect(sys.pristine()).toBe(true);
    expect(sys.foodBounds({ x: 0, z: 0 })).toEqual(sys.worldAabb({ x: 0, z: 0 }));
    // Standing in the crater: strictly below the top face, strictly above the board.
    const floor = sys.supportHeightAt(origin.x + anchor.x, origin.z + anchor.z, origin);
    expect(floor).toBeGreaterThan(boardTopY() + 1);
    expect(floor).toBeLessThan(origin.y + sys.hy - 6);
    // Away from the crater the top face is intact.
    const far = sys.supportHeightAt(origin.x - sys.hx * 0.5, origin.z + sys.hz * 0.5, origin);
    expect(far).toBeGreaterThan(origin.y + sys.hy - 4);
    // A real bite ends pristine; a fresh portion brings the crater back.
    const first = sys.chunks.find((c) => !c.eaten)!;
    sys.commitChunk(first.index);
    expect(sys.pristine()).toBe(false);
    sys.nextPortion();
    expect(sys.pristine()).toBe(true);
    expect(sys.chunks.filter((c) => c.eaten).length).toBe(fractured.openingBite.length);
    expect(sys.remainingMassGrams).toBeCloseTo(sys.portionMassGrams, 5);
    expect(sys.supportHeightAt(origin.x + anchor.x, origin.z + anchor.z, origin)).toBeCloseTo(floor, 5);
  });

  it('uses a contact radius of 0.3 visual body lengths', () => {
    expect(CONTACT_RADIUS_BODY_LENGTHS).toBe(0.3);
    expect(contactRadiusMm()).toBeCloseTo(flyVisualLengthMm() * 0.3);
    expect(contactRadiusMm()).toBe(scaleContactRadiusMm());
    const sys = new TwarogSystem(chunks(8), { x: 0, y: 0, z: 0 }, { store: null });
    const origin = { x: 0, y: 5, z: 0 };
    expect(sys.nearestUneaten(origin, contactRadiusMm())).toBe(0);
    expect(sys.nearestUneaten({ x: -contactRadiusMm() - 1, y: 5, z: 0 })).toBeNull();
  });

  it('reset restores uneaten mass and clears an in-progress bite', () => {
    const sys = new TwarogSystem(chunks(20), { x: 0, y: 0, z: 0 }, { store: null, seed: 3 });
    const first = sys.chunks[0]!;
    sys.step(input({
      pumping: true,
      labellum: first.centroid,
      dt: PUMP_PERIOD_S * 0.4,
      cameraDist: 1,
    }));
    expect(sys.consumeProgress(0)).toBeGreaterThan(0);
    sys.commitChunk(1);
    expect(sys.remainingMassGrams).toBeLessThan(CURD_TOTAL_MASS_G);
    sys.reset();
    expect(sys.remainingMassGrams).toBeCloseTo(CURD_TOTAL_MASS_G);
    expect(sys.uneatenCount).toBe(20);
    expect(sys.consumeProgress(0)).toBe(0);
    expect(sys.refilling).toBe(false);
  });

  it('loads portion 0 from empty storage and survives a throwing store', () => {
    expect(loadPortionCount(new MemoryStore())).toBe(0);
    const sys = new TwarogSystem(chunks(4), { x: 0, y: 0, z: 0 }, { store: new MemoryStore() });
    expect(sys.portionCount).toBe(0);
    const throwing: KvStore = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    };
    expect(loadPortionCount(throwing)).toBe(0);
    expect(() => savePortionCount(4, throwing)).not.toThrow();
  });

  it('persists the portion counter after an eternity refill', () => {
    const store = new MemoryStore();
    const sys = new TwarogSystem(chunks(10), { x: 0, y: 0, z: 0 }, { store, seed: 2 });
    for (const chunk of sys.chunks) sys.commitChunk(chunk.index);
    expect(sys.remainingMassGrams).toBeLessThan(ETERNITY_MASS_FRAC * sys.totalMassGrams);
    const groom = sys.step(input({ labellum: { x: 0, y: 0, z: 0 }, dt: 0.02 }));
    expect(groom.events.some((e) => e.type === 'groom')).toBe(true);
    const refill = sys.step(input({ labellum: { x: 0, y: 0, z: 0 }, dt: REFILL_ANIM_S }));
    expect(refill.events.some((e) => e.type === 'refill' && e.portion === 1)).toBe(true);
    expect(sys.remainingMassGrams).toBeCloseTo(CURD_TOTAL_MASS_G);
    expect(sys.portionCount).toBe(1);
    expect(loadPortionCount(store)).toBe(1);
    const again = new TwarogSystem(chunks(10), { x: 0, y: 0, z: 0 }, { store });
    expect(again.portionCount).toBe(1);
  });

  it('shrinks a contacted chunk over one pump period and emits 3–8 crumbs', () => {
    const sys = new TwarogSystem(chunks(12), { x: 0, y: 0, z: 0 }, { store: null, seed: 9 });
    const labellum = sys.chunks[0]!.centroid;
    sys.step(input({ pumping: true, labellum, dt: PUMP_PERIOD_S * 0.5, cameraDist: 1 }));
    expect(sys.scaleOf(0)).toBeCloseTo(0.5, 1);
    const done = sys.step(input({ pumping: true, labellum, dt: PUMP_PERIOD_S, cameraDist: 1 }));
    const consume = done.events.find((e) => e.type === 'consume');
    expect(consume?.type).toBe('consume');
    if (consume?.type === 'consume') {
      expect(consume.massGrams).toBeCloseTo(CURD_TOTAL_MASS_G / 12);
      expect(consume.crumbCount).toBeGreaterThanOrEqual(CRUMB_MIN);
      expect(consume.crumbCount).toBeLessThanOrEqual(CRUMB_MAX);
    }
    expect(sys.chunks[0]!.eaten).toBe(true);
  });

  it('crossfades LOD over 150 ms inside three body lengths', () => {
    expect(LOD_BODY_LENGTHS).toBe(3);
    expect(lodFadeSec()).toBeCloseTo(LOD_FADE_MS / 1000);
    expect(lodDistanceMm()).toBeCloseTo(flyVisualLengthMm() * 3);
    const sys = new TwarogSystem(chunks(4), { x: 0, y: 0, z: 0 }, { store: null });
    const labellum = { x: 0, y: 0, z: 0 };
    sys.step(input({ labellum, cameraDist: lodDistanceMm() + 10, dt: lodFadeSec() }));
    expect(sys.lodBlend).toBe(0);
    sys.step(input({ labellum, cameraDist: 1, dt: lodFadeSec() * 0.5 }));
    expect(sys.lodBlend).toBeGreaterThan(0.4);
    expect(sys.lodBlend).toBeLessThan(0.7);
    sys.step(input({ labellum, cameraDist: 1, dt: lodFadeSec() }));
    expect(sys.lodBlend).toBe(1);
  });

  it('maps short-range contact onto gustatory rates and keeps odor off that path', () => {
    const target = { x: 0, y: 0, z: 0 };
    const on = sampleContactFields([target], target, TWAROG_MAMUTA_WANILIOWY);
    expect(on.strength).toBeCloseTo(1);
    expect(on.sweet).toBeCloseTo(TWAROG_MAMUTA_WANILIOWY.sweet);
    const far = sampleContactFields([{ x: 80, y: 0, z: 80 }], target, TWAROG_MAMUTA_WANILIOWY);
    expect(far.strength).toBe(0);
    const pumping = contactToGustRates(on, true);
    const idle = contactToGustRates(on, false);
    expect(pumping.labellarHz).toBeGreaterThan(1);
    expect(pumping.pharyngealHz).toBeGreaterThan(1);
    expect(idle.pharyngealHz).toBe(0);
    const chemo = sampleChemo(
      [{ x: 400, y: 0, z: 400 }],
      null,
      { x: 5, z: 5 },
      { x: 0, z: 0 },
      true,
    );
    expect(chemo.odor).toBeGreaterThan(0.4);
    expect(chemo.rates.labellarHz).toBe(0);
    expect(chemo.rates.pharyngealHz).toBe(0);
  });

  it('raycasts a surface standoff and clamps the root outside the food AABB', () => {
    const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
    const origin = { x: 0, y: 15, z: 0 };
    const fly = { x: 0, y: 2, z: -200 };
    const target = sys.approachTarget(fly, origin);
    expect(pointInXzAabb(target.point, sys.worldAabb(origin))).toBe(false);
    expect(target.hit.z).toBeCloseTo(-sys.hz, 0);
    expect(target.distance).toBeGreaterThan(50);
    const inside = sys.clampRoot({ x: 0, y: 2, z: 0 }, origin, 0);
    expect(pointInXzAabb(inside, sys.worldAabb(origin), -0.01)).toBe(false);
  });

  it('recomputes bite-front from the fly instead of a fixed +X corner', () => {
    const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
    sys.followBiteFront({ x: 0, y: 0, z: -200 });
    expect(sys.biteFront.z).toBeLessThan(-sys.hz * 0.6);
    expect(Math.abs(sys.biteFront.x)).toBeLessThan(sys.hx * 0.5);
    const nearNegZ = sys.chunks.slice().sort((a, b) => a.biteDistance - b.biteDistance)[0]!;
    expect(nearNegZ.centroid.z).toBeLessThan(0);
    sys.followBiteFront({ x: 200, y: 0, z: 0 });
    expect(sys.biteFront.x).toBeGreaterThan(sys.hx * 0.6);
    const nearPosX = sys.chunks.slice().sort((a, b) => a.biteDistance - b.biteDistance)[0]!;
    expect(nearPosX.centroid.x).toBeGreaterThan(0);
  });

  it('supportHeightAt is the tallest uneaten chunk, else table, and drops when that chunk is eaten', () => {
    const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
    const origin = { x: 0, y: boardTopY() + mm(CURD_MM.height) / 2, z: 0 };
    const top = sys.chunks.filter((c) => !c.eaten).reduce((a, c) => (c.topY > a.topY ? c : a));
    const wx = origin.x + top.centroid.x;
    const wz = origin.z + top.centroid.z;
    const before = sys.supportHeightAt(wx, wz, origin);
    expect(before).toBeCloseTo(origin.y + top.topY, 5);
    expect(sys.supportHeightAt(400, 400, origin)).toBe(0);
    expect(sys.supportHeightAt(origin.x, origin.z, origin)).toBeGreaterThanOrEqual(origin.y);
    const covering = sys.chunks.filter((c) => !c.eaten
      && Math.hypot(wx - (origin.x + c.centroid.x), wz - (origin.z + c.centroid.z)) <= c.radiusXz);
    expect(covering.length).toBeGreaterThan(0);
    for (const c of covering) sys.commitChunk(c.index);
    const after = sys.supportHeightAt(wx, wz, origin);
    expect(after).toBeLessThan(before);
    for (const c of sys.chunks) sys.commitChunk(c.index);
    expect(sys.supportHeightAt(wx, wz, origin)).toBe(tableTopY());
  });

  it('projectOntoVerticalFace sits on the outward XZ normal', () => {
    const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
    const origin = { x: 0, y: 15, z: 0 };
    const p = sys.projectOntoVerticalFace({ x: 0, y: 8, z: -10 }, origin, 4);
    expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1);
    expect(p.y).toBe(8);
    const box = sys.worldAabb(origin);
    expect(pointInXzAabb({ x: p.x, z: p.z }, box, -0.5)).toBe(false);
  });

  it('picks a 3D-near top chunk, not an XZ-deep interior cell', () => {
    const layout = kitchenLayout();
    const food = layout.curd;
    const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
    const y = sys.supportHeightAt(food.x, food.z, food) + 2;
    const labellum = {
      x: 0,
      y: y - food.y,
      z: labellumRestReachMm(),
    };
    const idx = sys.nearestUneaten(labellum, sys.contactReachMm());
    expect(idx).not.toBeNull();
    expect(sys.chunks[idx!]!.centroid.y).toBeGreaterThan(5);
    const silent = sys.step(input({
      labellum,
      sensors: [labellum],
      flyXZ: { x: food.x, z: food.z },
      foodXZ: { x: food.x, z: food.z },
      cameraDist: 20,
    }));
    expect(silent.chemo.rates.labellarHz).toBeGreaterThan(8);
    const tasting = sys.step(input({
      labellum,
      sensors: [labellum],
      tasting: true,
      flyXZ: { x: food.x, z: food.z },
      foodXZ: { x: food.x, z: food.z },
      cameraDist: 20,
    }));
    expect(tasting.chemo.rates.labellarHz).toBeGreaterThan(20);
    expect(tasting.chemo.rates.pharyngealHz).toBe(0);
  });

  it('drives labellar Poisson from the bite-front chunk during side TASTE', () => {
    const layout = kitchenLayout();
    const food = layout.curd;
    const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
    const fly = { x: food.x + 180, y: tableTopY() + 2, z: food.z + 180 };
    const approach = sys.approachTarget(fly, food);
    sys.followBiteFront({
      x: approach.point.x - food.x,
      y: tableTopY() + 2 - food.y,
      z: approach.point.z - food.z,
    });
    const restLab = {
      x: approach.point.x + Math.sin(approach.yaw) * labellumRestReachMm() - food.x,
      y: tableTopY() + 2 - food.y,
      z: approach.point.z + Math.cos(approach.yaw) * labellumRestReachMm() - food.z,
    };
    const back = flyVisualLengthMm() * 4;
    const farLab = {
      x: restLab.x - Math.sin(approach.yaw) * back,
      y: restLab.y,
      z: restLab.z - Math.cos(approach.yaw) * back,
    };
    const miss = sys.step(input({
      labellum: farLab,
      sensors: [farLab],
      tasting: false,
      flyXZ: { x: approach.point.x - Math.sin(approach.yaw) * back, z: approach.point.z - Math.cos(approach.yaw) * back },
      foodXZ: { x: food.x, z: food.z },
    }));
    expect(miss.chemo.rates.labellarHz).toBe(0);
    const taste = sys.step(input({
      labellum: restLab,
      sensors: [restLab],
      tasting: true,
      flyXZ: { x: approach.point.x, z: approach.point.z },
      foodXZ: { x: food.x, z: food.z },
    }));
    expect(taste.chemo.rates.labellarHz).toBeGreaterThan(8);
  });
});
