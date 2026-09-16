import { describe, expect, it } from 'vitest';
import { parseTextureManifest } from '../../src/scene/textures.ts';
import { CURD_CHUNK_COUNT, CURD_MM, CURD_TOTAL_MASS_G } from '../../src/scene/scale.ts';
import { fractureCurdBlock } from '../../src/food/proceduralTwarog.ts';

describe('texture manifest', () => {
  it('throws when a required file key is missing', () => {
    expect(() => parseTextureManifest({ pack_front: 'a.png' })).toThrow(/missing/i);
  });

  it('accepts the kitchen manifest shape', () => {
    const m = parseTextureManifest({
      pack_front: 'pack_front.png',
      pack_back: 'pack_back.png',
      twarog_crumb: 'twarog_crumb.png',
      twarog_crumb_normal: 'twarog_crumb_normal.png',
      twarog_crumb_rough: 'twarog_crumb_rough.png',
      curd_median_hex: '#e1d7ca',
    });
    expect(m.pack_front).toBe('pack_front.png');
  });
});

describe('procedural twaróg fracture', () => {
  it('returns 200 convex chunks sorted from the bite front, masses summing to 250 g', () => {
    const fractured = fractureCurdBlock({ seed: 1 });
    expect(fractured.cells.length).toBe(CURD_CHUNK_COUNT);
    const masses = fractured.cells.map((c) => (c.volumeMm3 / 1000) * (CURD_TOTAL_MASS_G / (fractured.totalVolumeMm3 / 1000)));
    const sum = masses.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(CURD_TOTAL_MASS_G, 5);
    for (let i = 1; i < fractured.cells.length; i++) {
      expect(fractured.cells[i]!.biteDistance).toBeGreaterThanOrEqual(fractured.cells[i - 1]!.biteDistance - 1e-9);
    }
    const hx = CURD_MM.width / 2 + 1;
    const hy = CURD_MM.height / 2 + 1;
    const hz = CURD_MM.length / 2 + 1;
    for (const cell of fractured.cells) {
      expect(Math.abs(cell.centroid.x)).toBeLessThan(hx);
      expect(Math.abs(cell.centroid.y)).toBeLessThan(hy);
      expect(Math.abs(cell.centroid.z)).toBeLessThan(hz);
    }
  });
});
