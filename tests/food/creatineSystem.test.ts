import { describe, expect, it } from 'vitest';
import { CreatineSystem } from '../../src/food/creatineSystem.ts';
import { makePowderChunks, pileHeightAt } from '../../src/food/powderPile.ts';
import { PILE_MM, PILE_TOTAL_MASS_G, SCOOP_CAPACITY_G, TUB_MM, mm } from '../../src/scene/scale.ts';
import { scoopEatStand } from '../../src/scene/layout.ts';

describe('powder mound', () => {
  it('is tallest at the centre and zero at the rim', () => {
    expect(pileHeightAt(0, 0, PILE_MM.radius, PILE_MM.height)).toBeCloseTo(PILE_MM.height);
    expect(pileHeightAt(PILE_MM.radius, 0, PILE_MM.radius, PILE_MM.height)).toBe(0);
  });

  it('emits 80 cells totalling the authored 250 g', () => {
    const spec = makePowderChunks({ seed: 1 });
    expect(spec.chunks).toHaveLength(80);
    const mass = spec.chunks.reduce((s, c) => s + c.massGrams, 0);
    expect(mass).toBeCloseTo(PILE_TOTAL_MASS_G);
    expect(spec.hx).toBe(PILE_MM.radius);
  });
});

describe('CreatineSystem scoop', () => {
  it('uses the tub hull for approach, not the powder disc', () => {
    const sys = CreatineSystem.create({ seed: 1, store: null });
    expect(sys.hx).toBe(TUB_MM.diameter / 2);
    expect(sys.foodBounds({ x: 0, z: 0 }).hx).toBe(TUB_MM.diameter / 2);
    const origin = { x: 0, y: 0, z: 0 };
    expect(sys.supportHeightAt(0, 0, origin)).toBeCloseTo(mm(TUB_MM.wall) + mm(PILE_MM.height));
    expect(sys.supportHeightAt(400, 400, origin)).toBe(0);
  });

  it('pre-fills the scoop in the well on create', () => {
    const sys = CreatineSystem.create({ seed: 1, store: null });
    expect(sys.scoopMode).toBe('well');
    expect(sys.scoopFill).toBe(1);
  });

  it('dips surface mass into the scoop and drives chemo from the dropped bowl', () => {
    const sys = CreatineSystem.create({ seed: 1, store: null });
    const before = sys.remainingMassGrams;
    const taken = sys.dip();
    expect(taken).toBeGreaterThan(0);
    expect(sys.scoopFill).toBe(1);
    expect(sys.scoopMode).toBe('held');
    expect(sys.remainingMassGrams).toBeLessThan(before);
    expect(before - sys.remainingMassGrams).toBeGreaterThanOrEqual(SCOOP_CAPACITY_G * 0.5);

    const held = sys.step({
      dt: 0.05,
      pumping: true,
      tasting: true,
      labellum: { x: 80, y: 0, z: 80 },
      cameraDist: 400,
      sensors: [{ x: 80, y: 0, z: 80 }],
      foodXZ: { x: 0, z: 0 },
      flyXZ: { x: 30, z: 30 },
    });
    expect(sys.scoopFill).toBe(1);
    expect(held.events.some((e) => e.type === 'consume')).toBe(false);

    sys.drop();
    const stand = scoopEatStand();
    const out = sys.step({
      dt: 0.05,
      pumping: true,
      tasting: true,
      labellum: { x: stand.x, y: 0, z: stand.z },
      cameraDist: 400,
      sensors: [{ x: stand.x, y: 0, z: stand.z }],
      foodXZ: { x: 0, z: 0 },
      flyXZ: { x: stand.x, z: stand.z },
    });
    expect(sys.scoopMode).toBe('dropped');
    expect(out.chemo.contact.aa).toBeGreaterThan(0.4);
    expect(out.chemo.rates.labellarHz).toBeGreaterThan(10);
    expect(sys.scoopFill).toBeLessThan(1);
    expect(out.events.some((e) => e.type === 'consume')).toBe(true);
  });
});
