/**
 * Derive mid/hind coxa pivots from the Flybody `body` mesh.
 * Filter: y < -0.02 and |x| > 0.02. Three k-means clusters per side along Z.
 * Pivot = proximal-most vertex of the cluster (closest to the thorax origin).
 * The anterior cluster matches the existing foreleg groups and is not added.
 */
export const LEG_VERTEX_Y_MAX = -0.02;
export const LEG_VERTEX_ABS_X_MIN = 0.02;

export const MIDHIND_BONES = ['midleg_L', 'midleg_R', 'hindleg_L', 'hindleg_R'] as const;
export type MidHindBone = (typeof MIDHIND_BONES)[number];

export type DerivedCluster = {
  label: 'front' | 'mid' | 'hind';
  side: 'L' | 'R';
  n: number;
  position: [number, number, number];
  zMin: number;
  zMax: number;
  clusterRadius: number;
  zMean: number;
};

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function isLegVertex(x: number, y: number, z: number): boolean {
  void z;
  return y < LEG_VERTEX_Y_MAX && Math.abs(x) > LEG_VERTEX_ABS_X_MIN;
}

function kmeansZ(zs: number[]): Int32Array {
  const n = zs.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => zs[a]! - zs[b]!);
  const means = [
    zs[order[Math.floor(n / 6)]!]!,
    zs[order[Math.floor(n / 2)]!]!,
    zs[order[Math.floor((5 * n) / 6)]!]!,
  ];
  const assign = new Int32Array(n);
  for (let iter = 0; iter < 25; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(zs[i]! - means[k]!);
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      assign[i] = best;
    }
    const sum = [0, 0, 0];
    const cnt = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      sum[assign[i]!]! += zs[i]!;
      cnt[assign[i]!]! += 1;
    }
    for (let k = 0; k < 3; k++) {
      if (cnt[k]!) means[k] = sum[k]! / cnt[k]!;
    }
  }
  return assign;
}

function clusterSide(
  positions: Float32Array,
  side: 'L' | 'R',
): DerivedCluster[] {
  const sign = side === 'L' ? 1 : -1;
  const idx: number[] = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    if (isLegVertex(x, y, z) && Math.sign(x) === sign) idx.push(i);
  }
  const zs = idx.map((i) => positions[i * 3 + 2]!);
  const assign = kmeansZ(zs);
  const means = [0, 0, 0];
  const cnt = [0, 0, 0];
  for (let i = 0; i < idx.length; i++) {
    means[assign[i]!]! += zs[i]!;
    cnt[assign[i]!]! += 1;
  }
  for (let k = 0; k < 3; k++) if (cnt[k]!) means[k] = means[k]! / cnt[k]!;
  const order = [0, 1, 2].sort((a, b) => means[b]! - means[a]!);
  const labels: DerivedCluster['label'][] = ['front', 'mid', 'hind'];
  return order.map((k, oi) => {
    const members = idx.filter((_, i) => assign[i] === k);
    let prox = members[0]!;
    let pd = Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    let clusterRadius = 0;
    for (const i of members) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      const d = Math.hypot(x, y, z);
      if (d < pd) {
        pd = d;
        prox = i;
      }
      zMin = Math.min(zMin, z);
      zMax = Math.max(zMax, z);
    }
    const px = positions[prox * 3]!;
    const py = positions[prox * 3 + 1]!;
    const pz = positions[prox * 3 + 2]!;
    for (const i of members) {
      clusterRadius = Math.max(
        clusterRadius,
        Math.hypot(positions[i * 3]! - px, positions[i * 3 + 1]! - py, positions[i * 3 + 2]! - pz),
      );
    }
    return {
      label: labels[oi]!,
      side,
      n: members.length,
      position: [round4(px), round4(py), round4(pz)],
      zMin,
      zMax,
      clusterRadius,
      zMean: means[k]!,
    };
  });
}

export function deriveLegClusters(bodyPositions: Float32Array): DerivedCluster[] {
  return [...clusterSide(bodyPositions, 'L'), ...clusterSide(bodyPositions, 'R')];
}

export function deriveMidHindPivots(bodyPositions: Float32Array): Record<MidHindBone, DerivedCluster> {
  const all = deriveLegClusters(bodyPositions);
  const pick = (label: 'mid' | 'hind', side: 'L' | 'R') => {
    const c = all.find((x) => x.label === label && x.side === side);
    if (!c) throw new Error(`missing ${label} ${side} cluster`);
    return c;
  };
  return {
    midleg_L: pick('mid', 'L'),
    midleg_R: pick('mid', 'R'),
    hindleg_L: pick('hind', 'L'),
    hindleg_R: pick('hind', 'R'),
  };
}
