/**
 * Authored phase tempo for the feeding FSM (readability on the reel).
 *
 * Every phase must last at least `PHASE_MIN_S[state]` before it may exit by
 * *completion*. Interrupts are exempt and fire immediately:
 *   - bitter contact / satiety retract out of PUMP,
 *   - TASTE timeout back to SEARCH.
 *
 * What this does NOT touch: `PUMP_HZ` (the pharyngeal pump stays 6 Hz), clip
 * playback speed (`per`, `retract` still play at their authored speed and hold
 * the last frame), and the MN9 gate (`MN9_EXTEND_HZ`, `MN9_HOLD_MS`).
 * PUMP itself is lengthened by pumping more cycles (see `pumpCycleCount`),
 * not by a dwell, so a longer POMPUJ means more twaróg actually eaten.
 *
 * These numbers are authored, not measured. See docs/BODY-MODEL.md.
 */
import type { FeedingState } from './types.ts';

export const PHASE_MIN_S: Record<FeedingState, number> = {
  SEARCH: 0,
  ORIENT: 0,
  APPROACH: 1.2,
  TASTE: 1.0,
  EXTEND: 1.1,
  PUMP: 0,
  RETRACT: 0.8,
  REST: 0,
};

/** Shorter authored dwell on the reel path only (start→PUMP ≤ 20–30 s). */
export const PHASE_MIN_REEL_S: Record<FeedingState, number> = {
  SEARCH: 0,
  ORIENT: 0,
  APPROACH: 0.45,
  TASTE: 0.4,
  EXTEND: 0.55,
  PUMP: 0,
  RETRACT: 0.45,
  REST: 0,
};

/** True when `state` has lasted long enough to exit by completion. */
export function phaseMayComplete(
  state: FeedingState,
  stateAgeSec: number,
  mins: Record<FeedingState, number> = PHASE_MIN_S,
): boolean {
  return stateAgeSec >= mins[state];
}
