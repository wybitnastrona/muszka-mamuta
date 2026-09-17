import { describe, expect, it } from 'vitest';
import { CreatineSystem } from '../../src/food/creatineSystem.ts';
import { makePowderChunks, pileHeightAt } from '../../src/food/powderPile.ts';
import { PILE_MM, PILE_TOTAL_MASS_G, SCOOP_CAPACITY_G, TUB_MM } from '../../src/scene/scale.ts';

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
    expect(sys.supportHeightAt(0, 0, { x: 0, y: 7, z: 0 })).toBe(0);
  });

  it('dips surface mass into the scoop and drives chemo while held', () => {
    const sys = CreatineSystem.create({ seed: 1, store: null });
    const before = sys.remainingMassGrams;
    const taken = sys.dip();
    expect(taken).toBeGreaterThan(0);
    expect(sys.scoopFill).toBe(1);
    expect(sys.scoopMode).toBe('held');
    expect(sys.remainingMassGrams).toBeLessThan(before);
    expect(before - sys.remainingMassGrams).toBeGreaterThanOrEqual(SCOOP_CAPACITY_G * 0.5);

    const out = sys.step({
      dt: 0.05,
      pumping: true,
      labellum: { x: 80, y: 0, z: 80 },
      cameraDist: 400,
      sensors: [{ x: 80, y: 0, z: 80 }],
      foodXZ: { x: 0, z: 0 },
      flyXZ: { x: 30, z: 30 },
    });
    expect(out.chemo.contact.aa).toBeGreaterThan(0.4);
    expect(out.chemo.rates.labellarHz).toBeGreaterThan(10);
    expect(sys.scoopFill).toBeLessThan(1);
    expect(out.events.some((e) => e.type === 'consume')).toBe(true);
  });
});
