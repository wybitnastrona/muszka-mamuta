import { asset } from '../lib/atlas.ts';
import type { ActivityFrame } from '../lib/replay.ts';
import { idsForRole, parseCircuitMeta, type CircuitGraph } from './csr.ts';
import type { PopulationSummary } from './lif.ts';
import type { RoleTag } from './params.ts';
import type { WorkerIn, WorkerOut } from './protocol.ts';

export class BrainRuntime {
  seed: number;
  circuit: CircuitGraph | null = null;
  private worker: Worker | null = null;
  private ready = false;
  private metaUrl = '';
  private hydrating: Promise<void> | null = null;
  onFrame: ((frame: ActivityFrame, summary: PopulationSummary, seed: number) => void) | null = null;
  onReady: ((nNeurons: number, seed: number) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(seed = 1) {
    this.seed = seed >>> 0;
  }

  async connect(): Promise<void> {
    this.dispose();
    this.metaUrl = asset('data/feeding-circuit/graph.meta.json');
    const binUrl = asset('data/feeding-circuit/graph.bin');
    const [metaRes, binRes] = await Promise.all([fetch(this.metaUrl), fetch(binUrl)]);
    if (!metaRes.ok || !binRes.ok) {
      throw new Error(
        'Feeding-circuit graph is missing. Run scripts/data-prep/extract_feeding_circuit.py.',
      );
    }
    const metaBytes = await metaRes.arrayBuffer();
    const graph = await binRes.arrayBuffer();
    this.worker = new Worker(new URL('./lif-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerOut>) => this.handle(event.data);
    this.worker.onerror = (event) => this.onError?.(event.message);
    this.post({ type: 'init', graph, metaBytes, seed: this.seed }, [graph, metaBytes]);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => { void this.ensureCircuit(); }, 4000);
    } else {
      void this.ensureCircuit();
    }
  }

  async ensureCircuit(): Promise<void> {
    if (this.circuit) return;
    if (this.hydrating) return this.hydrating;
    this.hydrating = (async () => {
      const res = await fetch(this.metaUrl);
      if (!res.ok) throw new Error('graph.meta.json missing');
      const parsed = parseCircuitMeta(await res.json());
      this.circuit = {
        n: parsed.n,
        nEdges: parsed.nEdges,
        indptr: new Int32Array(0),
        indices: new Int32Array(0),
        weights: new Float32Array(0),
        bodyId: parsed.bodyId,
        role: parsed.role,
        pathSign: parsed.pathSign,
        type: parsed.type,
        subclass: parsed.subclass,
        ntUncertain: parsed.ntUncertain,
      };
    })();
    try {
      await this.hydrating;
    } finally {
      this.hydrating = null;
    }
  }

  start(): void {
    this.post({ type: 'start' });
  }

  stop(): void {
    this.post({ type: 'stop' });
  }

  reset(seed = this.seed): void {
    this.seed = seed >>> 0;
    this.post({ type: 'reset', seed: this.seed });
  }

  setSeed(seed: number): void {
    this.seed = seed >>> 0;
    this.post({ type: 'setSeed', seed: this.seed });
  }

  stimulate(ids: Int32Array, rateHz: number, durationMs: number): void {
    this.post({ type: 'stimulate', ids, rateHz, durationMs });
  }

  stimulateRole(role: RoleTag, rateHz: number, durationMs: number): void {
    if (!this.circuit) return;
    this.stimulate(idsForRole(this.circuit, role), rateHz, durationMs);
  }

  setGain(role: RoleTag, gain: number): void {
    this.post({ type: 'setGain', role, gain });
  }

  setMn9ThresholdShift(shiftMv: number): void {
    this.post({ type: 'setMn9ThresholdShift', shiftMv });
  }

  dispose(): void {
    this.ready = false;
    this.circuit = null;
    this.hydrating = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private post(msg: WorkerIn, transfer: Transferable[] = []): void {
    if (!this.worker) throw new Error('Brain runtime is not connected.');
    this.worker.postMessage(msg, transfer);
  }

  private handle(msg: WorkerOut): void {
    if (msg.type === 'error') {
      this.onError?.(msg.message);
      return;
    }
    if (msg.type === 'ready') {
      this.ready = true;
      this.seed = msg.seed;
      this.onReady?.(msg.nNeurons, msg.seed);
      return;
    }
    if (msg.type === 'frame' && this.ready) {
      this.onFrame?.({ time: msg.time, values: msg.values }, msg.summary, msg.seed);
    }
  }
}
