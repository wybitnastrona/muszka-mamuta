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
  CURD_TOTAL_MASS_G,
  LOD_BODY_LENGTHS,
  LOD_FADE_MS,
  contactRadiusMm as scaleContactRadiusMm,
  flyVisualLengthMm,
  lodDistanceMm,
  lodFadeSec,
} from '../../src/scene/scale.ts';

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
    let ingested = 0;
    for (const chunk of sys.chunks) ingested += sys.commitChunk(chunk.index);
    expect(ingested).toBeCloseTo(CURD_TOTAL_MASS_G, 5);
    expect(sys.remainingMassGrams).toBe(0);
    expect(sys.uneatenCount).toBe(0);
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
});
