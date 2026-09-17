import { smoothstep } from './math.ts';
import { EYE_MATERIAL_ALIAS, type BoneAnchor, type WeightGate } from './types.ts';

export type SkinBuffers = {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
};

export type SkinOptions = {
  material?: string;
  maxInfluences?: number;
};

export function resolvePartMaterial(name: string): string {
  return EYE_MATERIAL_ALIAS[name] ?? name;
}

export function boneFalloff(distance: number, maxRadius: number): number {
  if (maxRadius <= 0 || distance >= maxRadius) return 0;
  return 1 - smoothstep(0, maxRadius, distance);
}

function excludesMaterial(bone: BoneAnchor, material: string | undefined): boolean {
  if (!material || !bone.excludeMaterials?.length) return false;
  const resolved = resolvePartMaterial(material);
  return bone.excludeMaterials.some((name) => resolvePartMaterial(name) === resolved);
}

export function vertexPassesGate(x: number, y: number, z: number, gate: WeightGate): boolean {
  if (y >= gate.yMax) return false;
  if (Math.abs(x) <= gate.absXMin) return false;
  if (Math.sign(x) !== gate.xSign) return false;
  if (z < gate.zMin || z > gate.zMax) return false;
  return true;
}

/**
 * Smoothstep falloff inside each bone's maxRadius, hard zero beyond.
 * Material exclusions (eyes / ocelli on mouthparts) skip that bone entirely.
 * Raw weights are clamped so the per-vertex total never exceeds 1. Deficit
 * goes to root except on vertices whose only influences are gated leg bones
 * (those stay on the limb so a coxa sphere can move the hanging tarsus).
 */
export function computeSkinWeights(
  positions: Float32Array,
  bones: readonly BoneAnchor[],
  opts: SkinOptions = {},
): SkinBuffers {
  const n = Math.floor(positions.length / 3);
  const maxInfluences = opts.maxInfluences ?? 4;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const tmpI = new Int32Array(bones.length);
  const tmpW = new Float32Array(bones.length);

  for (let v = 0; v < n; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    let count = 0;
    let sum = 0;
    for (let b = 0; b < bones.length; b++) {
      if (excludesMaterial(bones[b], opts.material)) continue;
      const gate = bones[b].weightGate;
      if (gate && !vertexPassesGate(x, y, z, gate)) continue;
      const w = boneFalloff(
        Math.hypot(x - bones[b].position[0], y - bones[b].position[1], z - bones[b].position[2]),
        bones[b].maxRadius,
      );
      if (w <= 0) continue;
      tmpI[count] = b;
      tmpW[count] = w;
      sum += w;
      count++;
    }
    if (count === 0 || sum <= 0) {
      skinIndex[v * 4] = 0;
      skinWeight[v * 4] = 1;
      continue;
    }
    if (sum > 1) {
      const inv = 1 / sum;
      for (let i = 0; i < count; i++) tmpW[i] *= inv;
      sum = 1;
    }
    if (sum < 1) {
      let gatedOnly = true;
      for (let i = 0; i < count; i++) {
        if (!bones[tmpI[i]!]?.weightGate) {
          gatedOnly = false;
          break;
        }
      }
      if (!gatedOnly) {
      const deficit = 1 - sum;
      let rootSlot = -1;
      for (let i = 0; i < count; i++) {
        if (tmpI[i] === 0) {
          rootSlot = i;
          break;
        }
      }
      if (rootSlot >= 0) tmpW[rootSlot] += deficit;
      else {
        tmpI[count] = 0;
        tmpW[count] = deficit;
        count++;
      }
      }
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
    const inv = used > 0 ? 1 / used : 1;
    for (let j = 0; j < k; j++) {
      skinIndex[v * 4 + j] = tmpI[j];
      skinWeight[v * 4 + j] = tmpW[j] * inv;
    }
  }
  return { skinIndex, skinWeight };
}

export function vertexWeightSum(skinWeight: Float32Array, vertex: number): number {
  const o = vertex * 4;
  return skinWeight[o] + skinWeight[o + 1] + skinWeight[o + 2] + skinWeight[o + 3];
}

export function boneWeightOnVertex(
  skinIndex: Uint16Array,
  skinWeight: Float32Array,
  vertex: number,
  bone: number,
): number {
  const o = vertex * 4;
  let w = 0;
  for (let j = 0; j < 4; j++) {
    if (skinIndex[o + j] === bone) w += skinWeight[o + j];
  }
  return w;
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
