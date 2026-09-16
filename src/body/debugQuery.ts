import type { DebugMode, FeedingState } from './types.ts';

export type GateOverlay = {
  state: FeedingState;
  fsmMn9Hz: number;
  workerMn9Hz: number;
  mn9HoldMs: number;
  hunger: number;
  gustGain: number;
  mn9ThresholdShift: number;
  labellarHz: number;
  pharyngealHz: number;
  contactStrength: number;
};

export function parseDebugMode(search = typeof window === 'undefined' ? '' : window.location.search): DebugMode {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('debug');
  if (
    raw === 'weights' ||
    raw === 'motion' ||
    raw === 'extend' ||
    raw === 'pump' ||
    raw === 'label' ||
    raw === 'gate'
  ) {
    return raw;
  }
  return 'off';
}

export function formatGateOverlay(s: GateOverlay): string {
  const n = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : 'n/a');
  return [
    `state          ${s.state}`,
    `fsm mn9Rate    ${n(s.fsmMn9Hz)} Hz`,
    `worker mn9Rate ${n(s.workerMn9Hz)} Hz`,
    `mn9HoldMs      ${n(s.mn9HoldMs, 0)}`,
    `hunger         ${n(s.hunger)}`,
    `gustGain       ${n(s.gustGain, 3)}`,
    `mn9 ΔVth       ${n(s.mn9ThresholdShift)} mV`,
    `labellarHz     ${n(s.labellarHz, 1)}`,
    `pharyngealHz   ${n(s.pharyngealHz, 1)}`,
    `contact g      ${n(s.contactStrength, 3)}`,
  ].join('\n');
}
