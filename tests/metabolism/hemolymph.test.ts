import { describe, expect, it } from 'vitest';
import {
  CREATINE_KFD,
  TWAROG_MAMUTA_WANILIOWY,
  TWAROG_PLAIN_UNSWEETENED,
} from '../../src/food/foodProfile.ts';
import {
  ANATOMICAL_GUST_ROLES,
  MEASURED_GUST_ROLES,
} from '../../src/brain/params.ts';
import {
  BITE_MASS,
  CROP_UNITS_PER_GRAM,
  GUST_GAIN_0,
  GUST_GAIN_H,
  Hemolymph,
  MN9_SHIFT_0_MV,
  MN9_SHIFT_H_MV,
  trehaloseYield,
} from '../../src/metabolism/hemolymph.ts';
import { CURD_CHUNK_COUNT, CURD_TOTAL_MASS_G } from '../../src/scene/scale.ts';
import { GUST_GAIN_ROLES, MODULATION_PUSH_MS } from '../../src/metabolism/modulation.ts';

function starve(h: Hemolymph, minutes: number, dt = 1): void {
  const steps = Math.round((minutes * 60) / dt);
  for (let i = 0; i < steps; i++) h.step(dt);
}

function feed(h: Hemolymph, seconds: number, biteEvery = 2, mass = BITE_MASS, dt = 0.05): void {
  let t = 0;
  let nextBite = 0;
  while (t < seconds) {
    if (t >= nextBite) {
      h.bite(mass);
      nextBite += biteEvery;
    }
    h.step(dt);
    t += dt;
  }
}

function secondsToSatiety(
  profile: typeof TWAROG_MAMUTA_WANILIOWY,
  threshold: number,
): number {
  const h = new Hemolymph({ profile });
  const dt = 0.05;
  let t = 0;
  let nextBite = 0;
  const limit = 180;
  while (t < limit) {
    if (t >= nextBite) {
      h.bite(BITE_MASS);
      nextBite += 2;
    }
    h.step(dt);
    t += dt;
    if (h.satiety >= threshold) return t;
  }
  return Infinity;
}

describe('hemolymph (authored, not connectome)', () => {
  it('drops eating probability in the fed state versus hungry', () => {
    const hungry = new Hemolymph();
    starve(hungry, 20);
    const pHungry = hungry.eatingProbability;

    const fed = new Hemolymph();
    feed(fed, 40);
    for (let i = 0; i < 25; i++) fed.step(1);

    expect(fed.satiety).toBeGreaterThan(hungry.satiety);
    expect(fed.eatingProbability).toBeLessThan(pHungry);
    expect(fed.eatingProbability).toBeLessThan(hungry.eatingProbability);
  });

  it('raises hunger above 0.8 after 90 minutes without food', () => {
    const h = new Hemolymph();
    expect(h.hungerDrive).toBeLessThan(0.8);
    starve(h, 90);
    expect(h.hungerDrive).toBeGreaterThan(0.8);
    expect(h.state.cropVolume).toBe(0);
    expect(h.state.gutLoad).toBe(0);
  });

  it('conserves mass among crop, gut, absorbed and defecated', () => {
    const h = new Hemolymph({ spotsEnabled: false });
    expect(h.bite(0.35)).toBeCloseTo(0.35);
    expect(h.state.cropVolume + h.state.gutLoad).toBeCloseTo(0.35);

    for (let i = 0; i < 80; i++) h.step(0.25);
    h.bite(0.5);
    h.bite(0.5);
    for (let i = 0; i < 40; i++) h.step(0.5);

    const { ingested, crop, gut, absorbed, defecated } = h.massLedger;
    expect(crop + gut + absorbed + defecated).toBeCloseTo(ingested, 8);
    expect(crop).toBeGreaterThanOrEqual(0);
    expect(gut).toBeGreaterThanOrEqual(0);
    expect(crop).toBeLessThanOrEqual(1);
    expect(gut).toBeLessThanOrEqual(1);
  });

  it('reaches satiety sooner on vanilla-sweetened twaróg than on plain curd or creatine', () => {
    expect(trehaloseYield(TWAROG_MAMUTA_WANILIOWY) / trehaloseYield(TWAROG_PLAIN_UNSWEETENED)).toBeCloseTo(3, 5);

    const threshold = 0.5;
    const vanillaT = secondsToSatiety(TWAROG_MAMUTA_WANILIOWY, threshold);
    const plainT = secondsToSatiety(TWAROG_PLAIN_UNSWEETENED, threshold);
    const creatineT = secondsToSatiety(CREATINE_KFD, threshold);
    expect(vanillaT).toBeLessThan(Infinity);
    expect(vanillaT).toBeLessThan(plainT);
    expect(plainT - vanillaT).toBeGreaterThan(2);
    expect(vanillaT).toBeLessThan(creatineT);
  });

  it('emits defecation mass when the gut is full, and hides spots by default', () => {
    const hidden = new Hemolymph({ spotsEnabled: false });
    hidden.bite(1);
    for (let i = 0; i < 20; i++) hidden.step(1);
    expect(hidden.massLedger.defecated).toBeGreaterThan(0);
    expect(hidden.spots).toHaveLength(0);

    const shown = new Hemolymph({ spotsEnabled: true });
    shown.bite(1);
    for (let i = 0; i < 20; i++) shown.step(1);
    expect(shown.spots.length).toBeGreaterThan(0);
    expect(shown.spots[0].x).toBeGreaterThan(0);
    expect(shown.spots[0].x).toBeLessThan(1);
  });

  it('maps hunger onto whole-channel gustatory gain and an MN9 threshold shift', () => {
    const hungry = new Hemolymph();
    starve(hungry, 90);
    const fed = new Hemolymph();
    feed(fed, 50);
    for (let i = 0; i < 20; i++) fed.step(1);

    const mh = hungry.getModulation();
    const mf = fed.getModulation();
    expect(mh.gustGain).toBeGreaterThan(mf.gustGain);
    expect(mh.mn9ThresholdShift).toBeLessThan(mf.mn9ThresholdShift);
    expect(GUST_GAIN_ROLES).toEqual([...MEASURED_GUST_ROLES, ...ANATOMICAL_GUST_ROLES]);
    expect(GUST_GAIN_ROLES.includes('dan_pam')).toBe(false);
    expect(MODULATION_PUSH_MS).toBe(250);
  });

  it('at hunger 0.32 is slightly below rest gain, not a shutdown', () => {
    const h = 0.32;
    expect(GUST_GAIN_0 + GUST_GAIN_H * h).toBeCloseTo(0.94);
    expect(MN9_SHIFT_0_MV + MN9_SHIFT_H_MV * h).toBeCloseTo(0.24);
    const hemo = new Hemolymph({ profile: TWAROG_MAMUTA_WANILIOWY });
    expect(hemo.hungerDrive).toBeCloseTo(0.315, 2);
    const mod = hemo.getModulation();
    expect(mod.gustGain).toBeCloseTo(0.936, 2);
    expect(mod.mn9ThresholdShift).toBeCloseTo(0.25, 1);
    expect(mod.gustGain).toBeGreaterThan(0.9);
    expect(mod.mn9ThresholdShift).toBeLessThan(0.5);
  });

  it('converts an average Voronoi chunk into one authored bite', () => {
    const meanChunkG = CURD_TOTAL_MASS_G / CURD_CHUNK_COUNT;
    expect(CROP_UNITS_PER_GRAM * meanChunkG).toBeCloseTo(BITE_MASS);
    const viaEat = new Hemolymph();
    const viaBite = new Hemolymph();
    expect(viaEat.eat(meanChunkG)).toBeCloseTo(viaBite.bite(BITE_MASS));
    expect(viaEat.state.cropVolume).toBeCloseTo(viaBite.state.cropVolume);
  });
});
