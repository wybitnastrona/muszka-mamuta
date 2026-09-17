import { describe, expect, it } from 'vitest';
import type { CircuitGraph } from '../../src/brain/csr.ts';
import {
  PAM_BODY_IDS,
  applyRewardRoles,
  assertPamBodyIds,
  countShortestGustatoryToPamWalks,
  formatSignedPath,
  pamBodyIdsFromTypes,
  rewardRoleFromType,
  shortestGustatoryToPamPath,
} from '../../src/brain/reward.ts';

function graph(args: {
  n: number;
  edges?: Array<[number, number, number]>;
  roles?: CircuitGraph['role'];
  types?: Array<string | null>;
  bodyId?: number[];
}): CircuitGraph {
  const edges = args.edges ?? [];
  const counts = new Int32Array(args.n);
  for (const [pre] of edges) counts[pre]++;
  const indptr = new Int32Array(args.n + 1);
  for (let i = 0; i < args.n; i++) indptr[i + 1] = indptr[i] + counts[i];
  const indices = new Int32Array(edges.length);
  const weights = new Float32Array(edges.length);
  const cursor = indptr.slice();
  for (const [pre, post, w] of edges) {
    const at = cursor[pre]++;
    indices[at] = post;
    weights[at] = w;
  }
  return {
    n: args.n,
    nEdges: edges.length,
    indptr,
    indices,
    weights,
    bodyId: Int32Array.from(args.bodyId ?? Array.from({ length: args.n }, (_, i) => i + 1)),
    role: args.roles ?? Array.from({ length: args.n }, () => 'interneuron'),
    pathSign: Array.from({ length: args.n }, () => null),
    type: args.types,
  };
}

describe('rewardRoleFromType', () => {
  it('maps MaleCNS type prefixes only', () => {
    expect(rewardRoleFromType('PAM10')).toBe('dan_pam');
    expect(rewardRoleFromType('PPL108')).toBe('dan_ppl1');
    expect(rewardRoleFromType('PPL201')).toBe('dan_other');
    expect(rewardRoleFromType('PPM1201')).toBe('dan_other');
    expect(rewardRoleFromType('MBON01')).toBe('mbon');
    expect(rewardRoleFromType("KCa'b'-ap2")).toBe('kc');
    expect(rewardRoleFromType('PhG4')).toBeNull();
    expect(rewardRoleFromType('MN9')).toBeNull();
  });
});

describe('applyRewardRoles', () => {
  it('replaces interneuron from type and leaves gustatory / MN tags', () => {
    const roles = ['interneuron', 'gust_drive', 'mn9', 'interneuron'];
    const report = applyRewardRoles(roles, ['PAM10', 'PAM04', 'PPL101', 'MBON01']);
    expect(roles).toEqual(['dan_pam', 'gust_drive', 'mn9', 'mbon']);
    expect(report.changed).toBe(2);
    expect(report.byRole.dan_pam).toBe(1);
  });
});

describe('PAM bodyIds', () => {
  it('requires the verified 19 IDs and allows extras from MaleCNS type', () => {
    const ids = pamBodyIdsFromTypes(
      PAM_BODY_IDS,
      PAM_BODY_IDS.map(() => 'PAM10'),
    );
    expect(() => assertPamBodyIds(ids)).not.toThrow();
    expect(() => assertPamBodyIds([...ids, 1])).not.toThrow();
    expect(() => assertPamBodyIds(ids.slice(1))).toThrow(/missing/);
  });
});

describe('shortestGustatoryToPamPath', () => {
  it('returns the 2-hop signed walk when PAM is reachable', () => {
    const circuit = graph({
      n: 3,
      edges: [[0, 1, 4], [1, 2, 2]],
      roles: ['gust_drive', 'interneuron', 'dan_pam'],
      types: ['PhG4', 'SLP234', 'PAM10'],
      bodyId: [13491, 13537, 28434],
    });
    const path = shortestGustatoryToPamPath(circuit);
    expect(path).not.toBeNull();
    expect(path!.hops).toBe(2);
    expect(path!.productSign).toBe(1);
    expect(formatSignedPath(path!)).toContain('13491 PhG4');
    expect(formatSignedPath(path!)).toContain('28434 PAM10');
  });

  it('returns null when PAM is not reachable', () => {
    const circuit = graph({
      n: 2,
      roles: ['gust_drive', 'dan_pam'],
      types: ['PhG4', 'PAM10'],
    });
    expect(shortestGustatoryToPamPath(circuit)).toBeNull();
  });

  it('counts distinct shortest walks, not just the first BFS path', () => {
    const circuit = graph({
      n: 4,
      edges: [
        [0, 1, 1],
        [0, 2, 1],
        [1, 3, 1],
        [2, 3, 1],
      ],
      roles: ['gust_drive', 'interneuron', 'interneuron', 'dan_pam'],
      types: ['PhG4', 'SLP1', 'SLP2', 'PAM10'],
    });
    expect(countShortestGustatoryToPamWalks(circuit)).toEqual({ hops: 2, walks: 2 });
  });
});
