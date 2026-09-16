import { describe, expect, it } from 'vitest';
import { axisBox, beveledBox, clipPolyhedron, polyVolume, v3 } from '../../src/scene/polyhedron.ts';
import { SimplexNoise } from '../../src/scene/simplex.ts';

describe('polyhedron clip', () => {
  it('halves a unit cube on z = 0', () => {
    const cube = axisBox(1, 1, 1);
    expect(polyVolume(cube)).toBeCloseTo(8, 5);
    const kept = clipPolyhedron(cube, v3(0, 0, 1), 0);
    expect(kept).not.toBeNull();
    expect(polyVolume(kept!)).toBeCloseTo(4, 4);
  });

  it('bevels without emptying the box', () => {
    const box = beveledBox(40, 15, 50, 3);
    const vol = polyVolume(box);
    expect(vol).toBeGreaterThan(40 * 15 * 50 * 8 * 0.7);
    expect(vol).toBeLessThan(40 * 15 * 50 * 8);
  });
});

describe('simplex', () => {
  it('is deterministic for a seed and in range', () => {
    const a = new SimplexNoise(7);
    const b = new SimplexNoise(7);
    expect(a.noise3(1.2, 3.4, 5.6)).toBe(b.noise3(1.2, 3.4, 5.6));
    const n = a.noise2(0.3, 0.8);
    expect(n).toBeGreaterThan(-1.5);
    expect(n).toBeLessThan(1.5);
  });
});
