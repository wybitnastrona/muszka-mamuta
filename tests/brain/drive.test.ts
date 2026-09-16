import { describe, expect, it } from 'vitest';
import { driveDistribution, sortAndRank, tercileRole } from '../../src/brain/drive.ts';
import { LifNetwork, type CircuitGraph } from '../../src/brain/lif.ts';

function graph(args: {
  n: number;
  edges?: Array<[number, number, number]>;
  roles?: CircuitGraph['role'];
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
    bodyId: Int32Array.from(Array.from({ length: args.n }, (_, i) => i + 1)),
    role: args.roles ?? Array.from({ length: args.n }, () => 'interneuron'),
    pathSign: Array.from({ length: args.n }, () => null),
  };
}

describe('drive terciles', () => {
  it('ranks descending and splits 271-style counts into top/mid/bottom terciles', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ bodyId: i + 1, deltaMn9Hz: i }));
    const ranked = sortAndRank(rows);
    expect(ranked[0]).toEqual({ bodyId: 9, deltaMn9Hz: 8, rank: 1 });
    expect(ranked[8].rank).toBe(9);
    const roles = ranked.map((r) => tercileRole(r.rank, ranked.length));
    expect(roles).toEqual([
      'gust_drive',
      'gust_drive',
      'gust_drive',
      'gust_neutral',
      'gust_neutral',
      'gust_neutral',
      'gust_suppress',
      'gust_suppress',
      'gust_suppress',
    ]);
  });

  it('counts negative deltas', () => {
    const stats = driveDistribution([2, -1, 0, 4, -3]);
    expect(stats.min).toBe(-3);
    expect(stats.max).toBe(4);
    expect(stats.median).toBe(0);
    expect(stats.negative).toBe(2);
  });
});

describe('tonic background', () => {
  it('Poisson-drives gustatory seeds at the configured background rate', () => {
    const net = new LifNetwork(
      graph({ n: 1, roles: ['gust_drive'] }),
      1,
      { backgroundRateHz: 200 },
    );
    net.stepMs(100);
    expect(net.spikeCount[0]).toBeGreaterThan(5);
  });

  it('restores tonic after a stimulate pulse expires', () => {
    const net = new LifNetwork(
      graph({ n: 1, roles: ['gust_drive'] }),
      7,
      { backgroundRateHz: 50 },
    );
    net.stimulate(new Int32Array([1]), 0, 20);
    net.stepMs(20);
    const duringPulse = net.spikeCount[0];
    net.stepMs(80);
    expect(net.spikeCount[0]).toBeGreaterThan(duringPulse);
  });
});
