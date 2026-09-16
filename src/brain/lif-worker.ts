/// <reference lib="WebWorker" />

import { parseCircuit } from './csr.ts';
import { LifNetwork } from './lif.ts';
import { FRAME_MS } from './params.ts';
import type { WorkerIn, WorkerOut } from './protocol.ts';

let net: LifNetwork | null = null;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function send(msg: WorkerOut): void {
  postMessage(msg);
}

function fail(error: unknown): void {
  send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}

function tick(): void {
  if (!running || !net) return;
  const t0 = performance.now();
  try {
    const snap = net.stepFrame();
    send({ type: 'frame', time: snap.time, values: snap.values, summary: snap.summary, seed: net.seed });
  } catch (error) {
    running = false;
    fail(error);
    return;
  }
  const wait = Math.max(0, FRAME_MS - (performance.now() - t0));
  timer = setTimeout(tick, wait);
}

onmessage = (event: MessageEvent<WorkerIn>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init': {
        running = false;
        if (timer !== null) { clearTimeout(timer); timer = null; }
        const circuit = parseCircuit(msg.meta, msg.graph);
        net = new LifNetwork(circuit, msg.seed);
        send({ type: 'ready', nNeurons: net.n, seed: net.seed });
        break;
      }
      case 'start':
        if (!net) throw new Error('Brain worker is not initialized.');
        if (!running) {
          running = true;
          tick();
        }
        break;
      case 'stop':
        running = false;
        if (timer !== null) { clearTimeout(timer); timer = null; }
        break;
      case 'reset':
        if (!net) throw new Error('Brain worker is not initialized.');
        running = false;
        if (timer !== null) { clearTimeout(timer); timer = null; }
        net.reset(msg.seed ?? net.seed);
        send({ type: 'ready', nNeurons: net.n, seed: net.seed });
        break;
      case 'setSeed':
        if (!net) throw new Error('Brain worker is not initialized.');
        net.reset(msg.seed);
        send({ type: 'ready', nNeurons: net.n, seed: net.seed });
        break;
      case 'stimulate':
        if (!net) throw new Error('Brain worker is not initialized.');
        net.stimulate(msg.ids, msg.rateHz, msg.durationMs);
        break;
      case 'setGain':
        if (!net) throw new Error('Brain worker is not initialized.');
        net.setGain(msg.role, msg.gain);
        break;
      case 'setMn9ThresholdShift':
        if (!net) throw new Error('Brain worker is not initialized.');
        net.setMn9ThresholdShift(msg.shiftMv);
        break;
      default:
        throw new Error(`Unknown worker message ${(msg as { type: string }).type}`);
    }
  } catch (error) {
    fail(error);
  }
};
