/**
 * Authored wing visuals. Flybody has no `wings` material: the blades are the
 * `membrane` part of group `body`. We split that mesh into wing_L / wing_R
 * by connected-component centroid X (+X is anatomical left) and pivot each
 * at the vertex closest to the thorax. Mid/hind legs are procedural bones
 * on the body mesh; in flight they trail in rest pose (Card & Dickinson 2008).
 *
 * Wingbeat is ~200 Hz — blades are NOT posed per beat. Airborne look is a
 * translucent additive blur fan (~140°) plus a low-frequency blade flicker
 * (below 60 fps Nyquist) so the arc reads without strobing.
 * Ground: folded ~8° apart over the abdomen, occasional 25° idle flicks.
 * Nothing here writes into ActivityFrame or the brain worker.
 */
import * as THREE from 'three';
import { clamp01, DEG, hashNoise, lerp } from './math.ts';

export const WINGBEAT_HZ = 200;
export const BLUR_SWEEP_DEG = 140;
export const BLUR_LAND_FADE_S = 0.12;
/** Blade oscillation inside the blur fan; 9 Hz so 60 fps does not alias 200 Hz. */
export const WING_FLICKER_HZ = 9;
export const WING_FLICKER_DEG = 22;
export const WING_REST_SEPARATION_DEG = 8;
export const IDLE_FLICK_MIN_S = 4;
export const IDLE_FLICK_MAX_S = 9;
export const IDLE_FLICK_DUR_S = 0.18;
export const IDLE_FLICK_DEG = 25;
export const SONG_ENVELOPE_HZ = 5;

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
  /** Extra open-from-rest degrees (idle flick). */
  flickDeg?: number;
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

/** Rest: folded over the abdomen, slightly overlapping, 8° apart. Raised: out to the sides. */
const REST_PITCH = 1.18;
const REST_YAW = -0.05;
const REST_ROLL = (WING_REST_SEPARATION_DEG / 2) * DEG;
const RAISED_PITCH = 0.06;
const RAISED_YAW = 0;
const RAISED_ROLL = 1.05;
const REST_TO_RAISED_DEG = Math.hypot(
  (REST_PITCH - RAISED_PITCH) * (180 / Math.PI),
  (REST_ROLL - RAISED_ROLL) * (180 / Math.PI),
);

export function raiseForDeltaDeg(deltaDeg: number): number {
  return clamp01(deltaDeg / Math.max(1, REST_TO_RAISED_DEG));
}

function idleGap(i: number, seed: number): number {
  const u = hashNoise(i, seed) * 0.5 + 0.5;
  return IDLE_FLICK_MIN_S + u * (IDLE_FLICK_MAX_S - IDLE_FLICK_MIN_S);
}

/** Seeded 4–9 s single-wing flicks, 25° over 180 ms. */
export function wingIdleFlick(t: number, seed: number): { flickL: number; flickR: number } {
  if (t < 0) return { flickL: 0, flickR: 0 };
  let t0 = idleGap(0, seed);
  let i = 0;
  while (t0 + IDLE_FLICK_DUR_S < t && i < 4000) {
    i += 1;
    t0 += idleGap(i, seed);
  }
  const age = t - t0;
  if (age < 0 || age > IDLE_FLICK_DUR_S) return { flickL: 0, flickR: 0 };
  const env = Math.sin((age / IDLE_FLICK_DUR_S) * Math.PI) * IDLE_FLICK_DEG;
  const left = hashNoise(i + 17, seed) >= 0;
  return left ? { flickL: env, flickR: 0 } : { flickL: 0, flickR: env };
}

/** Fold 0 = stacked on the abdomen; 1 = raised / flight-ready. */
export function applyWingVisual(side: WingSide, visual: WingVisual): void {
  const flick = visual.flickDeg ?? 0;
  const u = clamp01(visual.raise + raiseForDeltaDeg(flick));
  const sign = side.side === 'L' ? 1 : -1;
  const flickerRad = visual.flicker * DEG;
  side.hinge.rotation.set(
    lerp(REST_PITCH, RAISED_PITCH, u) + flickerRad * 0.45,
    lerp(REST_YAW, RAISED_YAW, u) * sign + (visual.songDeg * DEG) * sign + flickerRad * 0.2 * sign,
    lerp(REST_ROLL, RAISED_ROLL, u) * sign,
  );
  const mat = side.blur.material as THREE.MeshBasicMaterial;
  const alpha = clamp01(visual.blurAlpha);
  mat.opacity = alpha * 0.5;
  side.blur.visible = alpha > 0.02;
}
