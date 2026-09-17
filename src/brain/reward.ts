/**
 * Reward-cluster role tags and graph walks.
 *
 * Types and body IDs come from MaleCNS annotations already in
 * `graph.meta.json`. We do not invent cells or assign mushroom-body
 * compartments (MaleCNS does not label PAM-β'2). See docs/DATA-PIPELINE.md.
 */
import type { CircuitGraph } from './csr.ts';
import { isGustatorySeed } from './drive.ts';
import type { RoleTag } from './params.ts';

export const REWARD_ROLES = ['dan_pam', 'dan_ppl1', 'dan_other', 'mbon', 'kc'] as const;
export type RewardRole = (typeof REWARD_ROLES)[number];

/**
 * PAM bodyIds present in this subgraph. Copied from graph.meta.json after
 * filtering `type` that starts with "PAM" — not guessed.
 */
export const PAM_BODY_IDS = [
  28434, 29565, 32865, 36624, 37845, 48113, 60930, 66934, 125080, 143120,
  170450, 178945, 200973, 520403, 520616, 525787, 544257, 544359, 547260,
] as const;

const REWARD_ROLE_SET = new Set<string>(REWARD_ROLES);

export function isRewardRole(role: RoleTag | string): role is RewardRole {
  return REWARD_ROLE_SET.has(role);
}

/** Map a MaleCNS `type` string onto a reward role. Null if it is not one. */
export function rewardRoleFromType(type: string | null | undefined): RewardRole | null {
  if (typeof type !== 'string' || type.length === 0) return null;
  if (type.startsWith('PAM')) return 'dan_pam';
  if (type.startsWith('PPL1')) return 'dan_ppl1';
  if (type.startsWith('PPL2') || type.startsWith('PPM')) return 'dan_other';
  if (type.startsWith('MBON')) return 'mbon';
  if (type.startsWith('KC')) return 'kc';
  return null;
}

export type RewardTagReport = {
  changed: number;
  byRole: Record<string, number>;
  types: Record<RewardRole, Record<string, number>>;
};

/**
 * Replace `interneuron` (or a previous reward tag) from `type` only.
 * Gustatory terciles, MN9, other MN, and DNs are left untouched.
 */
export function applyRewardRoles(
  roles: string[],
  types: Array<string | null | undefined>,
): RewardTagReport {
  if (roles.length !== types.length) {
    throw new Error('applyRewardRoles: role and type lengths differ');
  }
  const byRole: Record<string, number> = {};
  const typesOut: Record<RewardRole, Record<string, number>> = {
    dan_pam: {},
    dan_ppl1: {},
    dan_other: {},
    mbon: {},
    kc: {},
  };
  let changed = 0;
  for (let i = 0; i < roles.length; i++) {
    const next = rewardRoleFromType(types[i] ?? null);
    if (next && (roles[i] === 'interneuron' || isRewardRole(roles[i]))) {
      if (roles[i] !== next) changed += 1;
      roles[i] = next;
    }
    const role = roles[i] ?? 'interneuron';
    byRole[role] = (byRole[role] ?? 0) + 1;
    if (next && roles[i] === next) {
      const t = types[i] ?? 'unknown';
      typesOut[next][t] = (typesOut[next][t] ?? 0) + 1;
    }
  }
  return { changed, byRole, types: typesOut };
}

export function pamBodyIdsFromTypes(
  bodyId: ArrayLike<number>,
  types: Array<string | null | undefined>,
): number[] {
  const ids: number[] = [];
  for (let i = 0; i < types.length; i++) {
    if (rewardRoleFromType(types[i] ?? null) === 'dan_pam') ids.push(Number(bodyId[i]));
  }
  return ids.sort((a, b) => a - b);
}

export function assertPamBodyIds(ids: readonly number[]): void {
  const got = new Set(ids);
  const missing = PAM_BODY_IDS.filter((id) => !got.has(id));
  if (missing.length) {
    throw new Error(
      `Verified PAM bodyIds missing from type tags: [${missing.join(',')}]`,
    );
  }
}

export type PathNode = {
  bodyId: number;
  type: string | null;
  role: RoleTag;
  /** Sign of the incoming edge; null on the gustatory seed. */
  edgeSign: 1 | -1 | null;
};

export type SignedPath = {
  hops: number;
  productSign: 1 | -1;
  nodes: PathNode[];
};

function edgeSign(weight: number): 1 | -1 {
  return weight < 0 ? -1 : 1;
}

function nodeOf(circuit: CircuitGraph, index: number, sign: 1 | -1 | null): PathNode {
  return {
    bodyId: circuit.bodyId[index],
    type: circuit.type?.[index] ?? null,
    role: circuit.role[index],
    edgeSign: sign,
  };
}

/**
 * Shortest hop-path from any gustatory seed to any PAM cell in this CSR.
 * Multi-source BFS; starts sorted by bodyId so a tie is deterministic.
 * Returns null if PAM is not reachable in the extracted subgraph.
 */
export function shortestGustatoryToPamPath(circuit: CircuitGraph): SignedPath | null {
  const n = circuit.n;
  const starts: number[] = [];
  const pam = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (isGustatorySeed(circuit.role[i])) starts.push(i);
    const t = circuit.type?.[i];
    if (circuit.role[i] === 'dan_pam' || (typeof t === 'string' && t.startsWith('PAM'))) {
      pam[i] = 1;
    }
  }
  starts.sort((a, b) => circuit.bodyId[a] - circuit.bodyId[b]);
  if (starts.length === 0) return null;

  const visited = new Uint8Array(n);
  const parent = new Int32Array(n);
  const signFrom = new Int8Array(n);
  parent.fill(-1);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (const s of starts) {
    if (visited[s]) continue;
    visited[s] = 1;
    queue[qt++] = s;
  }

  let hit = -1;
  while (qh < qt) {
    const i = queue[qh++];
    if (pam[i] && parent[i] !== -1) {
      hit = i;
      break;
    }
    const begin = circuit.indptr[i];
    const end = circuit.indptr[i + 1];
    for (let e = begin; e < end; e++) {
      const post = circuit.indices[e];
      if (visited[post]) continue;
      visited[post] = 1;
      parent[post] = i;
      signFrom[post] = edgeSign(circuit.weights[e]);
      queue[qt++] = post;
    }
  }
  if (hit < 0) return null;

  const rev: PathNode[] = [];
  let cur = hit;
  let product: 1 | -1 = 1;
  while (cur >= 0) {
    const incoming = parent[cur] === -1 ? null : (signFrom[cur] as 1 | -1);
    if (incoming) product = (product * incoming) as 1 | -1;
    rev.push(nodeOf(circuit, cur, incoming));
    cur = parent[cur];
  }
  rev.reverse();
  return {
    hops: rev.length - 1,
    productSign: product,
    nodes: rev,
  };
}

/**
 * Number of distinct walks of the shortest hop-length from any gustatory
 * seed to any PAM cell. Null if PAM is unreachable.
 */
export function countShortestGustatoryToPamWalks(
  circuit: CircuitGraph,
): { hops: number; walks: number } | null {
  const n = circuit.n;
  const starts: number[] = [];
  const pam = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (isGustatorySeed(circuit.role[i])) starts.push(i);
    const t = circuit.type?.[i];
    if (circuit.role[i] === 'dan_pam' || (typeof t === 'string' && t.startsWith('PAM'))) {
      pam[i] = 1;
    }
  }
  if (starts.length === 0) return null;

  const dist = new Int32Array(n);
  dist.fill(-1);
  const ways = new Float64Array(n);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (const s of starts) {
    if (dist[s] >= 0) {
      ways[s] += 1;
      continue;
    }
    dist[s] = 0;
    ways[s] = 1;
    queue[qt++] = s;
  }

  while (qh < qt) {
    const i = queue[qh++];
    const d = dist[i];
    const begin = circuit.indptr[i];
    const end = circuit.indptr[i + 1];
    for (let e = begin; e < end; e++) {
      const post = circuit.indices[e];
      if (dist[post] < 0) {
        dist[post] = d + 1;
        ways[post] = ways[i];
        queue[qt++] = post;
      } else if (dist[post] === d + 1) {
        ways[post] += ways[i];
      }
    }
  }

  let hops = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    if (pam[i] && dist[i] > 0 && dist[i] < hops) hops = dist[i];
  }
  if (!Number.isFinite(hops)) return null;
  let walks = 0;
  for (let i = 0; i < n; i++) {
    if (pam[i] && dist[i] === hops) walks += ways[i];
  }
  return { hops, walks };
}

export function formatSignedPath(path: SignedPath): string {
  const hops = path.nodes.map((n, i) => {
    const t = n.type ?? n.role;
    if (i === 0) return `${n.bodyId} ${t}`;
    const s = n.edgeSign === -1 ? '−' : '+';
    return `${s}→ ${n.bodyId} ${t}`;
  });
  return `${path.hops} hops, productSign=${path.productSign > 0 ? '+' : '−'}1: ${hops.join(' ')}`;
}
