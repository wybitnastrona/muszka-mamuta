import type { RoleTag } from './params.ts';
import type { PopulationSummary } from './lif.ts';

export type WorkerIn =
  | { type: 'init'; graph: ArrayBuffer; metaBytes: ArrayBuffer; seed: number }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'reset'; seed?: number }
  | { type: 'stimulate'; ids: Int32Array; rateHz: number; durationMs: number }
  | { type: 'setGain'; role: RoleTag; gain: number }
  | { type: 'setMn9ThresholdShift'; shiftMv: number }
  | { type: 'setSeed'; seed: number };

export type WorkerOut =
  | { type: 'ready'; nNeurons: number; seed: number }
  | { type: 'frame'; time: number; values: [number, number][]; summary: PopulationSummary; seed: number }
  | { type: 'error'; message: string };

export const BRAIN_SOURCE = {
  kind: 'predicted' as const,
  name: 'MaleCNS feeding-circuit LIF (Shiu et al. 2024-style, authored parameters)',
  normalization: 'Firing rate in a 50 ms window / 50 Hz, clamped to [0, 1]',
};
