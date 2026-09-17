import { describe, expect, it } from 'vitest';
import { parseTextureManifest } from '../../src/scene/textures.ts';
import { CURD_CHUNK_COUNT, CURD_MM, CURD_TOTAL_MASS_G } from '../../src/scene/scale.ts';
import {
  buildLodGeometry,
  fractureCurdBlock,
  insideOpeningBite,
  openingBiteAnchor,
} from '../../src/food/proceduralTwarog.ts';
import { meshFromPolyhedron } from '../../src/scene/meshFromPoly.ts';

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

  it('carves an opening bite open to the top with the bottom layers intact', () => {
    const fractured = fractureCurdBlock({ seed: 1 });
    const { openingBite, biteAnchor, hx, hy, hz } = fractured;
    expect(biteAnchor).toEqual(openingBiteAnchor(hx, hy, hz));
    expect(biteAnchor.y).toBe(hy);
    // A meaningful notch: a few percent of cells, but well under a quarter.
    expect(openingBite.length).toBeGreaterThanOrEqual(8);
    expect(openingBite.length).toBeLessThan(CURD_CHUNK_COUNT / 4);
    for (const i of openingBite) {
      const c = fractured.cells[i]!.centroid;
      expect(insideOpeningBite(c, biteAnchor)).toBe(true);
      // Nothing in the bottom third of the block is bitten: the crater has a floor.
      expect(c.y).toBeGreaterThan(-hy / 3);
    }
    const eaten = new Set(openingBite);
    const rest = fractured.cells.filter((_, i) => !eaten.has(i));
    expect(rest.length).toBe(CURD_CHUNK_COUNT - openingBite.length);
  });

  it('builds a single far-LOD geometry from the uneaten cells only', () => {
    const fractured = fractureCurdBlock({ seed: 1 });
    const geoms = fractured.cells.map((c) => meshFromPolyhedron(c.poly, fractured.hx, fractured.hy, fractured.hz, 2).geometry);
    const all = buildLodGeometry(geoms, new Set());
    const lod = buildLodGeometry(geoms, new Set(fractured.openingBite));
    const total = geoms.reduce((s, g) => s + g.getAttribute('position').count, 0);
    expect(all.getAttribute('position').count).toBe(total);
    expect(lod.getAttribute('position').count).toBeLessThan(total);
    expect(lod.groups.length).toBe(2);
    expect(lod.groups[0]!.materialIndex).toBe(0);
    expect(lod.groups[1]!.materialIndex).toBe(1);
    expect(lod.getAttribute('normal')).toBeTruthy();
  });
});
