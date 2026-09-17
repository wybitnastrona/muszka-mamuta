/**
 * UNUSED. Rejected dopamine readout — keep the negative result.
 * See docs/DATA-PIPELINE.md § "Rejected: dopamine readout (keep the negative result)".
 *
 * This integrator was never a connectome hormone. PAM in the shipped 20k
 * graph is effectively silent; widening the graph produced an unphysiological
 * excitatory loop. Nothing in the app imports this module.
 *
 * d(tone)/dt = (pamRate / PAM_REF − tone) / TAU
 * PAM_REF is the strongest 500 ms PAM rate in reward.json (single-seed protocol).
 */
import { clamp01 } from '../brain/params.ts';

/** From measure_reward.ts: strongest 500 ms PAM rate (bodyId 122806, 0.842 Hz). */
export const PAM_REF_HZ = 0.842;

/** Leaky integrator time constant. Authored display/behaviour, not MaleCNS. */
export const DOPAMINE_TAU_S = 4;

/** Was: NAP only when satiety is high AND reward has faded. Unused. */
export const NAP_TONE_MAX = 0.3;

/** Was: courtshipSong entry uses tone, not raw satiety. Unused. */
export const COURTSHIP_TONE_MIN = 0.5;

/** Was: +25% pharyngeal pump rate at tone = 1. Unused. */
export const PUMP_RATE_TONE_GAIN = 0.25;

export type BiteRecord = {
  massGrams: number;
  position: { x: number; y: number; z: number };
  t: number;
};

export class DopamineTone {
  tone = 0;
  lastBite: BiteRecord | null = null;

  reset(): void {
    this.tone = 0;
    this.lastBite = null;
  }

  onBite(massGrams: number, position: { x: number; y: number; z: number }, t = 0): void {
    this.lastBite = { massGrams, position, t };
  }

  step(dt: number, pamRateHz: number): number {
    const target = PAM_REF_HZ > 0 ? pamRateHz / PAM_REF_HZ : 0;
    this.tone += (dt * (target - this.tone)) / DOPAMINE_TAU_S;
    if (this.tone < 0) this.tone = 0;
    return this.tone;
  }

  display(): number {
    return clamp01(this.tone);
  }
}

export function pumpRateScale(tone: number): number {
  return 1 + PUMP_RATE_TONE_GAIN * clamp01(tone);
}
