import { describe, expect, it } from 'vitest';
import {
  analyticLifRateHz,
  FRAME_STEPS,
  V_TH_MV,
  V_REST_MV,
} from '../../src/brain/params.ts';
import { LifNetwork, type CircuitGraph } from '../../src/brain/lif.ts';

function graph(args: {
  n: number;
  edges?: Array<[number, number, number]>;
  roles?: CircuitGraph['role'];
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
  };
}

describe('LIF F–I curve', () => {
  it('spikes at the analytic rate ±10% under constant current', () => {
    const net = new LifNetwork(graph({ n: 1 }), 1);
    const iExt = 15;
    net.setCurrent(0, iExt);
    const durationMs = 400;
    net.stepMs(durationMs);
    const measured = net.spikeCount[0] / (durationMs / 1000);
    const expected = analyticLifRateHz(iExt);
    expect(expected).toBeGreaterThan(10);
    expect(measured).toBeGreaterThan(expected * 0.9);
    expect(measured).toBeLessThan(expected * 1.1);
    expect(iExt).toBeGreaterThan(V_TH_MV - V_REST_MV);
  });
});

describe('synaptic chain', () => {
  it('propagates through a two-neuron excitatory synapse', () => {
    const connected = new LifNetwork(
      graph({ n: 2, edges: [[0, 1, 400]] }),
      1,
    );
    connected.setCurrent(0, 15);
    connected.stepMs(200);
    expect(connected.spikeCount[0]).toBeGreaterThan(5);
    expect(connected.spikeCount[1]).toBeGreaterThan(0);

    const isolated = new LifNetwork(graph({ n: 2 }), 1);
    isolated.setCurrent(0, 15);
    isolated.stepMs(200);
    expect(isolated.spikeCount[1]).toBe(0);
  });

  it('suppresses the postsynaptic cell with an inhibitory synapse', () => {
    const excited = new LifNetwork(graph({ n: 3, edges: [[0, 1, 400]] }), 1);
    excited.setCurrent(0, 15);
    excited.stepMs(250);
    const withInh = new LifNetwork(
      graph({
        n: 3,
        edges: [
          [0, 1, 400],
          [2, 1, -800],
        ],
      }),
      1,
    );
    withInh.setCurrent(0, 15);
    withInh.setCurrent(2, 15);
    withInh.stepMs(250);
    expect(excited.spikeCount[1]).toBeGreaterThan(0);
    expect(withInh.spikeCount[1]).toBeLessThan(excited.spikeCount[1] * 0.5);
  });
});

describe('deterministic RNG', () => {
  it('replays an identical spike train for the same seed', () => {
    const run = (seed: number) => {
      const net = new LifNetwork(
        graph({ n: 3, edges: [[0, 1, 400], [1, 2, 400]] }),
        seed,
      );
      net.stimulate(new Int32Array([1]), 120, 80);
      const stamps: number[] = [];
      for (let s = 0; s < 800; s++) {
        const fired = net.step();
        for (let k = 0; k < fired; k++) stamps.push(s * 10 + net.lastSpikes[k]);
      }
      return stamps;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });
});

describe('MN9 threshold shift', () => {
  it('reduces MN9 firing when the authored threshold is raised', () => {
    const easy = new LifNetwork(graph({ n: 1, roles: ['mn9'] }), 1);
    easy.setCurrent(0, 12);
    easy.stepMs(200);
    const hard = new LifNetwork(graph({ n: 1, roles: ['mn9'] }), 1);
    hard.setMn9ThresholdShift(4);
    hard.setCurrent(0, 12);
    hard.stepMs(200);
    expect(easy.spikeCount[0]).toBeGreaterThan(0);
    expect(hard.spikeCount[0]).toBeLessThan(easy.spikeCount[0]);
  });
});

describe.skipIf(process.env.PERF !== '1')('perf budget', () => {
  it('steps 20k neurons × 167 dt under 12 ms', () => {
    const n = 20_000;
    const degree = 8;
    const nEdges = n * degree;
    const indptr = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) indptr[i + 1] = (i + 1) * degree;
    const indices = new Int32Array(nEdges);
    const weights = new Float32Array(nEdges);
    for (let i = 0; i < nEdges; i++) {
      indices[i] = (i * 17 + 3) % n;
      weights[i] = 1;
    }
    const net = new LifNetwork(
      {
        n,
        nEdges,
        indptr,
        indices,
        weights,
        bodyId: new Int32Array(n).map((_, i) => i + 1),
        role: Array.from({ length: n }, () => 'interneuron' as const),
        pathSign: Array.from({ length: n }, () => null),
      },
      1,
    );
    for (let i = 0; i < 200; i++) net.setCurrent(i, 12);
    net.step();
    const t0 = performance.now();
    net.step(FRAME_STEPS);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(12);
  });
});
