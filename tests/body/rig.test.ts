import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeFlybodyHierarchy, type FlybodyMeta, ANCHORS } from '../../src/body/hierarchy.ts';
import { computeSkinWeights, dominantBone } from '../../src/body/skinWeights.ts';
import { BONE_NAMES } from '../../src/body/types.ts';

const meta = JSON.parse(
  readFileSync(new URL('../../public/data/flybody/model.json', import.meta.url), 'utf8'),
) as FlybodyMeta;

describe('Flybody hierarchy', () => {
  it('has no skeleton; body is unrigged; front legs are named groups', () => {
    const report = describeFlybodyHierarchy(meta);
    expect(report.hasSkeleton).toBe(false);
    expect(report.bodyUnrigged).toBe(true);
    expect(report.groups).toEqual(['body', 'front_left', 'front_right']);
    expect(report.namedLegGroups).toEqual(['front_left', 'front_right']);
  });

  it('maps authored foreleg bones onto those named groups', () => {
    const left = ANCHORS.bones.find((b) => b.name === 'foreleg_L_tarsus');
    const right = ANCHORS.bones.find((b) => b.name === 'foreleg_R_tarsus');
    expect(left?.legGroup).toBe('front_left');
    expect(right?.legGroup).toBe('front_right');
    expect(left?.position).toEqual(meta.pivots.front_left);
    expect(right?.position).toEqual(meta.pivots.front_right);
  });
});

describe('distance weights', () => {
  it('binds a labellum landmark to labellum_L', () => {
    const L = ANCHORS.bones.find((b) => b.name === 'labellum_L')!;
    const positions = new Float32Array(L.position);
    const { skinIndex, skinWeight } = computeSkinWeights(positions, ANCHORS.bones);
    const idx = dominantBone(skinIndex, skinWeight, 0);
    expect(BONE_NAMES[idx]).toBe('labellum_L');
    expect(skinWeight[0]).toBeGreaterThan(0.5);
  });

  it('binds a far abdomen vertex to abdomen or root', () => {
    const positions = new Float32Array([0, -0.05, -0.16]);
    const { skinIndex, skinWeight } = computeSkinWeights(positions, ANCHORS.bones);
    const name = BONE_NAMES[dominantBone(skinIndex, skinWeight, 0)];
    expect(['abdomen', 'root']).toContain(name);
    expect(skinWeight[0]).toBeGreaterThan(0.4);
  });
});
