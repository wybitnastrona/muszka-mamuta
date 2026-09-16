import type { BoneAnchor } from './types.ts';

export type SkinBuffers = {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
};

/**
 * Inverse-square falloff inside each bone's authored radius, top-4 influences.
 * Vertices with no bone in range bind fully to bone 0 (root).
 */
export function computeSkinWeights(
  positions: Float32Array,
  bones: readonly BoneAnchor[],
  maxInfluences = 4,
): SkinBuffers {
  const n = Math.floor(positions.length / 3);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const tmpI = new Int32Array(bones.length);
  const tmpW = new Float32Array(bones.length);

  for (let v = 0; v < n; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    let count = 0;
    for (let b = 0; b < bones.length; b++) {
      const r = bones[b].radius;
      if (r <= 0) continue;
      const p = bones[b].position;
      const d = Math.hypot(x - p[0], y - p[1], z - p[2]);
      const t = 1 - d / r;
      if (t <= 0) continue;
      tmpI[count] = b;
      tmpW[count] = t * t;
      count++;
    }
    if (count === 0) {
      skinIndex[v * 4] = 0;
      skinWeight[v * 4] = 1;
      continue;
    }
    for (let a = 1; a < count; a++) {
      const ib = tmpI[a];
      const wb = tmpW[a];
      let j = a;
      while (j > 0 && tmpW[j - 1] < wb) {
        tmpI[j] = tmpI[j - 1];
        tmpW[j] = tmpW[j - 1];
        j--;
      }
      tmpI[j] = ib;
      tmpW[j] = wb;
    }
    const k = Math.min(maxInfluences, count);
    let used = 0;
    for (let j = 0; j < k; j++) used += tmpW[j];
    for (let j = 0; j < k; j++) {
      skinIndex[v * 4 + j] = tmpI[j];
      skinWeight[v * 4 + j] = tmpW[j] / used;
    }
  }
  return { skinIndex, skinWeight };
}

export function dominantBone(skinIndex: Uint16Array, skinWeight: Float32Array, vertex: number): number {
  const o = vertex * 4;
  let best = 0;
  let w = skinWeight[o];
  for (let j = 1; j < 4; j++) {
    if (skinWeight[o + j] > w) {
      w = skinWeight[o + j];
      best = j;
    }
  }
  return skinIndex[o + best];
}

export function mixBoneColor(
  skinIndex: Uint16Array,
  skinWeight: Float32Array,
  vertex: number,
  palette: readonly (readonly [number, number, number])[],
): [number, number, number] {
  const o = vertex * 4;
  let r = 0, g = 0, b = 0;
  for (let j = 0; j < 4; j++) {
    const w = skinWeight[o + j];
    if (w <= 0) continue;
    const c = palette[skinIndex[o + j]] ?? palette[0];
    r += c[0] * w;
    g += c[1] * w;
    b += c[2] * w;
  }
  return [r, g, b];
}
