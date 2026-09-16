/**
 * Authored wing visuals. Flybody has no `wings` material: the blades are the
 * `membrane` part of group `body`. We split that mesh into wing_L / wing_R
 * by connected-component centroid X (+X is anatomical left) and pivot each
 * at the vertex closest to the thorax. Mid/hind legs stay unrigged in the
 * standing pose during flight (real Drosophila trail those legs).
 *
 * Wingbeat is ~200 Hz — blades are NOT posed per beat. Airborne look is a
 * translucent additive blur fan (~140°) plus a small per-frame flicker.
 * Nothing here writes into ActivityFrame or the brain worker.
 */
import * as THREE from 'three';
import { clamp01 } from './math.ts';

export const WINGBEAT_HZ = 200;
export const BLUR_SWEEP_DEG = 140;
export const BLUR_LAND_FADE_S = 0.12;
export const WING_FLICKER_DEG = 3;

export type WingBuffers = {
  positions: Float32Array;
  indices: Uint32Array;
  pivot: [number, number, number];
  centroid: [number, number, number];
};

export type SplitWings = {
  wing_L: WingBuffers;
  wing_R: WingBuffers;
};

export type WingVisual = {
  raise: number;
  songDeg: number;
  flicker: number;
  blurAlpha: number;
};

function uniqueVertices(positions: Float32Array, indices: readonly number[]): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const map = new Map<number, number>();
  const outPos: number[] = [];
  const outIdx: number[] = [];
  for (const old of indices) {
    let next = map.get(old);
    if (next === undefined) {
      next = map.size;
      map.set(old, next);
      outPos.push(positions[old * 3]!, positions[old * 3 + 1]!, positions[old * 3 + 2]!);
    }
    outIdx.push(next);
  }
  return { positions: new Float32Array(outPos), indices: new Uint32Array(outIdx) };
}

function connectedComponents(count: number, indices: Uint32Array): number[][] {
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (a: number): number => {
    let i = a;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  for (let t = 0; t + 2 < indices.length; t += 3) {
    union(indices[t]!, indices[t + 1]!);
    union(indices[t]!, indices[t + 2]!);
  }
  const bins = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const r = find(i);
    const list = bins.get(r);
    if (list) list.push(i);
    else bins.set(r, [i]);
  }
  return [...bins.values()];
}

function centroidOf(positions: Float32Array, verts: readonly number[]): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (const i of verts) {
    x += positions[i * 3]!;
    y += positions[i * 3 + 1]!;
    z += positions[i * 3 + 2]!;
  }
  const n = Math.max(1, verts.length);
  return [x / n, y / n, z / n];
}

function closestToThorax(positions: Float32Array, verts: readonly number[]): number {
  let best = verts[0]!;
  let bestD = Infinity;
  for (const i of verts) {
    const d = Math.hypot(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function componentBuffers(
  positions: Float32Array,
  indices: Uint32Array,
  verts: readonly number[],
): WingBuffers {
  const set = new Set(verts);
  const tri: number[] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
    if (set.has(a) && set.has(b) && set.has(c)) tri.push(a, b, c);
  }
  const packed = uniqueVertices(positions, tri);
  const all = Array.from({ length: packed.positions.length / 3 }, (_, i) => i);
  const centroid = centroidOf(packed.positions, all);
  const pivotIdx = closestToThorax(packed.positions, all);
  const pivot: [number, number, number] = [
    packed.positions[pivotIdx * 3]!,
    packed.positions[pivotIdx * 3 + 1]!,
    packed.positions[pivotIdx * 3 + 2]!,
  ];
  for (let i = 0; i < packed.positions.length; i += 3) {
    packed.positions[i]! -= pivot[0];
    packed.positions[i + 1]! -= pivot[1];
    packed.positions[i + 2]! -= pivot[2];
  }
  return { positions: packed.positions, indices: packed.indices, pivot, centroid };
}

/**
 * Split a `membrane` mesh into anatomical left (+X) and right (−X) wings.
 */
export function splitMembraneWings(positions: Float32Array, indices: Uint32Array): SplitWings {
  const count = Math.floor(positions.length / 3);
  const parts = connectedComponents(count, indices);
  if (parts.length < 2) {
    throw new Error('membrane mesh did not split into two wings');
  }
  const ranked = parts
    .map((verts) => ({ verts, c: centroidOf(positions, verts) }))
    .sort((a, b) => b.c[0] - a.c[0]);
  const left = ranked.find((p) => p.c[0] > 0) ?? ranked[0]!;
  const right = ranked.find((p) => p.c[0] < 0) ?? ranked[ranked.length - 1]!;
  return {
    wing_L: componentBuffers(positions, indices, left.verts),
    wing_R: componentBuffers(positions, indices, right.verts),
  };
}

export function wingBlurGeometry(span: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(span, 24, (-BLUR_SWEEP_DEG / 2) * Math.PI / 180, BLUR_SWEEP_DEG * Math.PI / 180);
  geo.rotateY(Math.PI / 2);
  return geo;
}

export type WingSide = {
  hinge: THREE.Group;
  mesh: THREE.Mesh;
  blur: THREE.Mesh;
  side: 'L' | 'R';
};

export type WingRig = {
  L: WingSide;
  R: WingSide;
};

function makeSide(
  buffers: WingBuffers,
  material: THREE.Material,
  blurMat: THREE.Material,
  side: 'L' | 'R',
): WingSide {
  const hinge = new THREE.Group();
  hinge.name = side === 'L' ? 'wing_L' : 'wing_R';
  hinge.position.fromArray(buffers.pivot);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  geometry.computeVertexNormals();
  const uv = new Float32Array((buffers.positions.length / 3) * 2);
  for (let i = 0; i < buffers.positions.length / 3; i++) {
    uv[i * 2] = buffers.positions[i * 3]! * 14 + 0.5;
    uv[i * 2 + 1] = buffers.positions[i * 3 + 2]! * 10 + 0.5;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = hinge.name + '_blade';
  mesh.frustumCulled = false;
  const span = Math.max(0.04, Math.hypot(
    buffers.centroid[0] - buffers.pivot[0],
    buffers.centroid[1] - buffers.pivot[1],
    buffers.centroid[2] - buffers.pivot[2],
  ) * 1.35);
  const blur = new THREE.Mesh(wingBlurGeometry(span), blurMat);
  blur.name = hinge.name + '_blur';
  blur.visible = false;
  blur.frustumCulled = false;
  blur.renderOrder = 6;
  hinge.add(mesh, blur);
  return { hinge, mesh, blur, side };
}

export function createWingBlurMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xcfe4f4,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

export function attachSplitWings(
  root: THREE.Object3D,
  split: SplitWings,
  membrane: THREE.Material,
): WingRig {
  const blurMat = createWingBlurMaterial();
  const L = makeSide(split.wing_L, membrane, blurMat.clone(), 'L');
  const R = makeSide(split.wing_R, membrane, blurMat.clone(), 'R');
  root.add(L.hinge, R.hinge);
  return { L, R };
}

/** Fold 0 = stacked on the abdomen; 1 = raised / flight-ready. */
export function applyWingVisual(side: WingSide, visual: WingVisual): void {
  const folded = 1 - clamp01(visual.raise);
  const sign = side.side === 'L' ? 1 : -1;
  side.hinge.rotation.set(
    folded * 1.15 + visual.flicker * 0.02,
    (visual.songDeg * Math.PI / 180) * sign + visual.flicker * 0.015 * sign,
    folded * 0.55 * sign,
  );
  const mat = side.blur.material as THREE.MeshBasicMaterial;
  const alpha = clamp01(visual.blurAlpha);
  mat.opacity = alpha * 0.42;
  side.blur.visible = alpha > 0.02;
}
