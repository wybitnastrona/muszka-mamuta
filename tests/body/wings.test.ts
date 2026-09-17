import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeFlybodyHierarchy, type FlybodyMeta } from '../../src/body/hierarchy.ts';
import { splitMembraneWings, applyWingVisual, wingIdleFlick, WING_FLICKER_DEG, WING_FLICKER_HZ, WING_REST_SEPARATION_DEG, IDLE_FLICK_MIN_S, IDLE_FLICK_MAX_S, IDLE_FLICK_DUR_S, IDLE_FLICK_DEG, type WingSide } from '../../src/body/wings.ts';

const meta = JSON.parse(
  readFileSync(new URL('../../public/data/flybody/model.json', import.meta.url), 'utf8'),
) as FlybodyMeta;

describe('membrane wings', () => {
  it('has a membrane part and no wings material', () => {
    const report = describeFlybodyHierarchy(meta);
    expect(report.materialsByGroup.body).toContain('membrane');
    expect(report.materialsByGroup.body).not.toContain('wings');
  });

  it('splits membrane into wing_L (+) and wing_R (−) by centroid X', () => {
    const part = meta.parts.find((p) => p.group === 'body' && p.material === 'membrane');
    expect(part).toBeDefined();
    const bin = readFileSync(new URL('../../public/data/flybody/model.bin', import.meta.url));
    const positions = new Float32Array(
      bin.buffer,
      bin.byteOffset + part!.positionByteOffset,
      part!.positionCount * 3,
    );
    const indices = new Uint32Array(
      bin.buffer,
      bin.byteOffset + part!.indexByteOffset,
      part!.indexCount,
    );
    const split = splitMembraneWings(new Float32Array(positions), new Uint32Array(indices));
    expect(split.wing_L.centroid[0]).toBeGreaterThan(0);
    expect(split.wing_R.centroid[0]).toBeLessThan(0);
    expect(split.wing_L.positions.length).toBeGreaterThan(30);
    expect(split.wing_R.positions.length).toBeGreaterThan(30);
  });
});

describe('ground and flight wing poses', () => {
  function dummy(side: 'L' | 'R'): WingSide {
    const hinge = { rotation: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } } };
    return {
      hinge: hinge as unknown as WingSide['hinge'],
      mesh: {} as WingSide['mesh'],
      blur: { visible: false, material: { opacity: 0 } } as unknown as WingSide['blur'],
      side,
    };
  }

  it('rests both blades ~8° apart over the abdomen', () => {
    const L = dummy('L');
    const R = dummy('R');
    const rest = { raise: 0, songDeg: 0, flicker: 0, blurAlpha: 0 };
    applyWingVisual(L, rest);
    applyWingVisual(R, rest);
    const apart = Math.abs(L.hinge.rotation.z - R.hinge.rotation.z) * (180 / Math.PI);
    expect(apart).toBeCloseTo(WING_REST_SEPARATION_DEG, 5);
  });

  it('fires a seeded 25° single-wing flick every 4–9 s for 180 ms', () => {
    expect(IDLE_FLICK_MIN_S).toBe(4);
    expect(IDLE_FLICK_MAX_S).toBe(9);
    expect(IDLE_FLICK_DUR_S).toBeCloseTo(0.18);
    let lastOn = -99;
    let flicks = 0;
    for (let t = 0; t < 40; t += 0.02) {
      const f = wingIdleFlick(t, 1);
      const on = f.flickL > 0.5 || f.flickR > 0.5;
      expect(f.flickL > 0.5 && f.flickR > 0.5).toBe(false);
      if (on && t - lastOn > 0.3) {
        flicks += 1;
        if (flicks > 1) {
          expect(t - lastOn).toBeGreaterThanOrEqual(IDLE_FLICK_MIN_S - 0.05);
          expect(t - lastOn).toBeLessThanOrEqual(IDLE_FLICK_MAX_S + IDLE_FLICK_DUR_S + 0.05);
        }
        lastOn = t;
      }
    }
    expect(flicks).toBeGreaterThan(2);
    const peak = Math.max(...Array.from({ length: 2000 }, (_, i) => {
      const f = wingIdleFlick(i * 0.02, 1);
      return Math.max(f.flickL, f.flickR);
    }));
    expect(peak).toBeGreaterThan(IDLE_FLICK_DEG * 0.9);
  });

  it('uses a sub-Nyquist flicker so 200 Hz is the blur fan, not a posed beat', () => {
    expect(WING_FLICKER_HZ).toBeLessThan(30);
    expect(WING_FLICKER_DEG).toBeGreaterThan(10);
  });
});

