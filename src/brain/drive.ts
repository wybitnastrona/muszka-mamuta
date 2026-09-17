import type { RoleTag } from './params.ts';
import {
  ANATOMICAL_GUST_ROLES,
  LABELLAR_SUBCLASSES,
  MEASURED_GUST_ROLES,
  PHARYNGEAL_SUBCLASSES,
} from './params.ts';

export type DriveRecord = { bodyId: number; deltaMn9Hz: number; rank: number };
export type MeasuredGustRole = (typeof MEASURED_GUST_ROLES)[number];

const GUST_ROLE_SET = new Set<string>([...MEASURED_GUST_ROLES, ...ANATOMICAL_GUST_ROLES]);

export function isGustatorySeed(role: RoleTag | string): boolean {
  return GUST_ROLE_SET.has(role);
}

export function isLabellarSubclass(subclass: string | null | undefined): boolean {
  return typeof subclass === 'string' && (LABELLAR_SUBCLASSES as readonly string[]).includes(subclass);
}

export function isPharyngealSubclass(subclass: string | null | undefined): boolean {
  return typeof subclass === 'string' && (PHARYNGEAL_SUBCLASSES as readonly string[]).includes(subclass);
}

/** Rank 1 = largest delta. Tie-break: lower bodyId first. */
export function sortAndRank(rows: Array<{ bodyId: number; deltaMn9Hz: number }>): DriveRecord[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.deltaMn9Hz !== a.deltaMn9Hz) return b.deltaMn9Hz - a.deltaMn9Hz;
    return a.bodyId - b.bodyId;
  });
  return sorted.map((row, i) => ({ bodyId: row.bodyId, deltaMn9Hz: row.deltaMn9Hz, rank: i + 1 }));
}

/** Top / middle / bottom tercile of a descending rank list (rank 1 = strongest MN9 drive). */
export function tercileRole(rank: number, n: number): MeasuredGustRole {
  if (n <= 0) throw new Error('tercileRole: empty set');
  if (rank < 1 || rank > n) throw new Error(`tercileRole: rank ${rank} not in 1..${n}`);
  const index = rank - 1;
  if (index < n / 3) return 'gust_drive';
  if (index < (2 * n) / 3) return 'gust_neutral';
  return 'gust_suppress';
}

export function driveDistribution(deltas: number[]): {
  n: number;
  min: number;
  max: number;
  median: number;
  negative: number;
} {
  if (deltas.length === 0) return { n: 0, min: NaN, max: NaN, median: NaN, negative: 0 };
  const sorted = [...deltas].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median,
    negative: sorted.filter((d) => d < 0).length,
  };
}

export function meanRoleHz(
  spikeCount: Uint32Array,
  roles: RoleTag[],
  timeSec: number,
  role: RoleTag,
): { n: number; spikes: number; hz: number; ms: number } {
  let n = 0;
  let spikes = 0;
  for (let i = 0; i < roles.length; i++) {
    if (roles[i] !== role) continue;
    n++;
    spikes += spikeCount[i];
  }
  const ms = timeSec * 1000;
  return { n, spikes, hz: n === 0 || ms === 0 ? 0 : spikes / n / (ms / 1000), ms };
}

export function meanMn9Hz(
  spikeCount: Uint32Array,
  roles: RoleTag[],
  timeSec: number,
): { n: number; spikes: number; hz: number; ms: number } {
  return meanRoleHz(spikeCount, roles, timeSec, 'mn9');
}

/** Whole-channel labellar drive is sublinear vs the strongest single seed. */
export function channelRiseIsSublinear(maxSingleDeltaHz: number, wholeChannelRiseHz: number): boolean {
  return maxSingleDeltaHz > wholeChannelRiseHz;
}
