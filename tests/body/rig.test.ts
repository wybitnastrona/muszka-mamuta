import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeFlybodyHierarchy, type FlybodyMeta, ANCHORS } from '../../src/body/hierarchy.ts';
import {
  boneFalloff,
  boneWeightOnVertex,
  computeSkinWeights,
  dominantBone,
  vertexWeightSum,
} from '../../src/body/skinWeights.ts';
import { smoothstep } from '../../src/body/math.ts';
import { BONE_NAMES, MOUTHPART_BONES } from '../../src/body/types.ts';
import { deriveMidHindPivots } from '../../src/body/legPivots.ts';

const meta = JSON.parse(
  readFileSync(new URL('../../public/data/flybody/model.json', import.meta.url), 'utf8'),
) as FlybodyMeta;

function indexOf(name: (typeof BONE_NAMES)[number]): number {
  return BONE_NAMES.indexOf(name);
}

function mouthpartWeight(skinIndex: Uint16Array, skinWeight: Float32Array, vertex = 0): number {
  let w = 0;
  for (const name of MOUTHPART_BONES) {
    w += boneWeightOnVertex(skinIndex, skinWeight, vertex, indexOf(name));
  }
  return w;
}

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

  it('places mid/hind coxae at the derived proximal vertices', () => {
    const part = meta.parts.find((p) => p.group === 'body' && p.material === 'body')!;
    const bin = readFileSync(new URL('../../public/data/flybody/model.bin', import.meta.url));
    const positions = new Float32Array(
      bin.buffer,
      bin.byteOffset + part.positionByteOffset,
      part.positionCount * 3,
    );
    const derived = deriveMidHindPivots(positions);
    for (const name of ['midleg_L', 'midleg_R', 'hindleg_L', 'hindleg_R'] as const) {
      const bone = ANCHORS.bones.find((b) => b.name === name)!;
      expect(bone.parent).toBe('root');
      expect(bone.maxRadius).toBeGreaterThan(0);
      expect(bone.weightGate).toBeDefined();
      expect(bone.position[0]).toBeCloseTo(derived[name].position[0], 3);
      expect(bone.position[1]).toBeCloseTo(derived[name].position[1], 3);
      expect(bone.position[2]).toBeCloseTo(derived[name].position[2], 3);
    }
  });

  it('gives every bone a maxRadius and mouthparts an eyes/ocelli exclusion', () => {
    expect(ANCHORS.bones.map((b) => b.name)).toEqual([...BONE_NAMES]);
    for (const bone of ANCHORS.bones) {
      expect(bone.maxRadius).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(bone.maxRadius)).toBe(true);
    }
    const mouth = ANCHORS.bones.filter((b) => (MOUTHPART_BONES as readonly string[]).includes(b.name));
    expect(mouth).toHaveLength(4);
    for (const bone of mouth) {
      expect(bone.excludeMaterials).toEqual(expect.arrayContaining(['eyes', 'ocelli']));
    }
    const rostrum = ANCHORS.bones.find((b) => b.name === 'rostrum')!;
    const haustellum = ANCHORS.bones.find((b) => b.name === 'haustellum')!;
    const labellumL = ANCHORS.bones.find((b) => b.name === 'labellum_L')!;
    const labellumR = ANCHORS.bones.find((b) => b.name === 'labellum_R')!;
    expect(rostrum.maxRadius).toBe(0.013);
    expect(haustellum.maxRadius).toBe(0.018);
    expect(labellumL.maxRadius).toBe(0.01);
    expect(labellumR.maxRadius).toBe(0.01);
    expect(rostrum.maxRadius).toBeLessThan(0.0277);
    expect(haustellum.maxRadius).toBeLessThan(0.0358);
    expect(labellumL.maxRadius).toBeLessThan(0.0088 + 0.002);
  });
});

describe('smoothstep falloff', () => {
  it('is 1 at the bone, 0 at and beyond maxRadius', () => {
    const r = 0.016;
    expect(boneFalloff(0, r)).toBe(1);
    expect(boneFalloff(r, r)).toBe(0);
    expect(boneFalloff(r + 1e-6, r)).toBe(0);
    expect(boneFalloff(r / 2, r)).toBeCloseTo(1 - smoothstep(0, r, r / 2));
    expect(boneFalloff(r / 2, r)).toBeCloseTo(0.5);
  });
});

describe('distance weights', () => {
  it('binds a labellum landmark to labellum_L', () => {
    const L = ANCHORS.bones.find((b) => b.name === 'labellum_L')!;
    const positions = new Float32Array(L.position);
    const { skinIndex, skinWeight } = computeSkinWeights(positions, ANCHORS.bones, { material: 'bristle-brown' });
    const idx = dominantBone(skinIndex, skinWeight, 0);
    expect(BONE_NAMES[idx]).toBe('labellum_L');
    expect(skinWeight[0]).toBeGreaterThan(0.5);
    expect(vertexWeightSum(skinWeight, 0)).toBeCloseTo(1);
  });

  it('binds a far abdomen vertex to abdomen or root', () => {
    const positions = new Float32Array([0, -0.05, -0.16]);
    const { skinIndex, skinWeight } = computeSkinWeights(positions, ANCHORS.bones);
    const name = BONE_NAMES[dominantBone(skinIndex, skinWeight, 0)];
    expect(['abdomen', 'root']).toContain(name);
    expect(skinWeight[0]).toBeGreaterThan(0.4);
    expect(vertexWeightSum(skinWeight, 0)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('gives eyes and ocelli zero weight from every mouthpart bone', () => {
    const rostrum = ANCHORS.bones.find((b) => b.name === 'rostrum')!;
    const positions = new Float32Array(rostrum.position);
    for (const material of ['red', 'eyes', 'ocelli'] as const) {
      const { skinIndex, skinWeight } = computeSkinWeights(positions, ANCHORS.bones, { material });
      expect(mouthpartWeight(skinIndex, skinWeight)).toBe(0);
      expect(vertexWeightSum(skinWeight, 0)).toBeCloseTo(1);
    }
    const body = computeSkinWeights(positions, ANCHORS.bones, { material: 'body' });
    expect(boneWeightOnVertex(body.skinIndex, body.skinWeight, 0, indexOf('rostrum'))).toBeGreaterThan(0.5);
  });

  it('gives a hanging midleg vertex to midleg_L and a thorax vertex to root', () => {
    const mid = computeSkinWeights(new Float32Array([0.10, -0.08, 0.01]), ANCHORS.bones, { material: 'body' });
    expect(BONE_NAMES[dominantBone(mid.skinIndex, mid.skinWeight, 0)]).toBe('midleg_L');
    const thorax = computeSkinWeights(new Float32Array([0, 0, 0]), ANCHORS.bones, { material: 'body' });
    expect(BONE_NAMES[dominantBone(thorax.skinIndex, thorax.skinWeight, 0)]).toBe('root');
    expect(boneWeightOnVertex(thorax.skinIndex, thorax.skinWeight, 0, indexOf('midleg_L'))).toBe(0);
    expect(boneWeightOnVertex(thorax.skinIndex, thorax.skinWeight, 0, indexOf('hindleg_L'))).toBe(0);
  });

  it('clamps overlapping raw weights so the vertex total is not above 1', () => {
    const L = ANCHORS.bones.find((b) => b.name === 'labellum_L')!;
    const { skinWeight } = computeSkinWeights(new Float32Array(L.position), ANCHORS.bones, {
      material: 'bristle-brown',
    });
    expect(vertexWeightSum(skinWeight, 0)).toBeLessThanOrEqual(1 + 1e-6);
  });
});
