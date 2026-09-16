import { asset } from '../lib/atlas.ts';
import type { ActivityFrame } from '../lib/replay.ts';
import { idsForRole, parseCircuit, type CircuitGraph } from './csr.ts';
import type { PopulationSummary } from './lif.ts';
import type { RoleTag } from './params.ts';
import type { WorkerIn, WorkerOut } from './protocol.ts';

export class BrainRuntime {
  seed: number;
  circuit: CircuitGraph | null = null;
  private worker: Worker | null = null;
  private ready = false;
  onFrame: ((frame: ActivityFrame, summary: PopulationSummary, seed: number) => void) | null = null;
  onReady: ((nNeurons: number, seed: number) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(seed = 1) {
    this.seed = seed >>> 0;
  }

  async connect(): Promise<void> {
    this.dispose();
    const metaUrl = asset('data/feeding-circuit/graph.meta.json');
    const binUrl = asset('data/feeding-circuit/graph.bin');
    const [metaRes, binRes] = await Promise.all([fetch(metaUrl), fetch(binUrl)]);
    if (!metaRes.ok || !binRes.ok) {
      throw new Error(
        'Feeding-circuit graph is missing. Run scripts/data-prep/extract_feeding_circuit.py.',
      );
    }
    const meta: unknown = await metaRes.json();
    const graph = await binRes.arrayBuffer();
    this.circuit = parseCircuit(meta, graph);
    this.worker = new Worker(new URL('./lif-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerOut>) => this.handle(event.data);
    this.worker.onerror = (event) => this.onError?.(event.message);
    this.post({ type: 'init', graph, meta, seed: this.seed }, [graph]);
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

  dispose(): void {
    this.ready = false;
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
