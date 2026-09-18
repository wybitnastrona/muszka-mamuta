/**
 * Presentation-only smoothing for the soma atlas ("02 / ATLAS SOM").
 *
 * `ActivityFrame` reaches the panel at ~10 Hz (HUD_HZ_MS); the atlas renders
 * at rAF. These helpers ease the displayed activity toward the last frame and
 * scale the shader pulse. Nothing here writes into ActivityFrame, the worker,
 * or the `rate / RATE_NORM_HZ` normalisation — it is how the same numbers are
 * drawn, not what they are.
 *
 * The PUMP emphasis is driven by the body FSM state (see docs/DATA-PIPELINE.md
 * and BODY-MODEL.md): during POMPUJ the pharyngeal seeds really are the only
 * time `pharyngealHz > 0`, so the panel genuinely lights up more; the gain
 * amplifies that correlate rather than inventing activity.
 */
import type { FeedingState } from '../body/types.ts';

/** Time constant for displayed activity to reach a new 10 Hz sample. */
export const ACTIVITY_TAU_S = 0.08;
/** Time constant for the pulse gain to follow the FSM state. */
export const PULSE_GAIN_TAU_S = 0.2;
export const PULSE_GAIN_REST = 1;
/** Eating creatine: 500% of rest (presentation gain on the soma atlas). */
export const PULSE_GAIN_PUMP = 5;
/** Mill walk: 300% of rest, RGB offset in the atlas shader. */
export const PULSE_GAIN_RUN = 3;
/** Base pulse rate (rad/s factor applied in the shader); rate rises with gain. */
export const PULSE_RATE_HZ = 1.1;

export function easeToward(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return target;
  const k = 1 - Math.exp(-dt / tau);
  return current + (target - current) * k;
}

/** Ease every displayed value toward its target; returns the largest remaining gap. */
export function easeActivity(
  displayed: Float32Array,
  target: Float32Array,
  dt: number,
  tau = ACTIVITY_TAU_S,
): number {
  const k = tau <= 0 || dt <= 0 ? 1 : 1 - Math.exp(-dt / tau);
  let maxGap = 0;
  for (let i = 0; i < displayed.length; i++) {
    const gap = target[i]! - displayed[i]!;
    displayed[i]! += gap * k;
    const rest = Math.abs(target[i]! - displayed[i]!);
    if (rest > maxGap) maxGap = rest;
  }
  return maxGap;
}

/** Shader gain for the current feeding phase / mill walk. Presentation only. */
export function pulseTargetGain(
  state: FeedingState | null | undefined,
  millRunning = false,
): number {
  if (state === 'PUMP') return PULSE_GAIN_PUMP;
  if (millRunning) return PULSE_GAIN_RUN;
  return PULSE_GAIN_REST;
}
