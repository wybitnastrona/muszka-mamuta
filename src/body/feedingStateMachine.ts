import type { ClipName, FeedingEvent, FeedingState } from './types.ts';
import { headingError, turnToward, clamp, clamp01 } from './math.ts';
import { CLIP_DURATION, PUMP_HZ, clipForState } from './feedingMotion.ts';
import { ODOR_DETECT } from './odorField.ts';
import { phaseMayComplete, PHASE_MIN_REEL_S, PHASE_MIN_S } from './tempo.ts';
import { flyVisualLengthMm } from '../scene/scale.ts';

export const HEADING_ALIGN_DEG = 15;
export const MN9_EXTEND_HZ = 8;
export const MN9_HOLD_MS = 80;
export const SATIETY_RETRACT = 0.85;
export const BITTER_RETRACT = 0.12;
export const TURN_RATE_RAD_S = 2.4;
/** @deprecated Arrival used to compare against the food centroid. Prefer `APPROACH_ARRIVE_MM`. */
export const NEAR_FOOD = flyVisualLengthMm() * 0.4;
/** Close enough to the surface-standoff point to leave APPROACH. */
export const APPROACH_ARRIVE_MM = 1;
export const STEP_LENGTH = flyVisualLengthMm() * 0.35;
/** Gate eligibility floor; the readable dwell is PHASE_MIN_S.TASTE (tempo.ts). */
export const TASTE_MIN_S = 0.25;
/** Raised with the longer TASTE dwell so the MN9 gate still has time to open. */
export const TASTE_TIMEOUT_S = 3.0;
/** Pump cycles per bout at threshold / at strong MN9 drive. PUMP_HZ is unchanged. */
export const PUMP_CYCLES_MIN = 8;
export const PUMP_CYCLES_MAX = 14;
export const PUMP_CYCLES_REEL_MIN = 5;
export const PUMP_CYCLES_REEL_MAX = 8;
export const GROOM_SATIETY = 0.7;

export type FeedingInput = {
  dt: number;
  mn9Rate: number;
  bitter: number;
  satiety: number;
  /** Vanillin gradient. Steers ORIENT only — never MN9. */
  odorYaw: number;
  odorStrength: number;
  /**
   * Distance to the surface-standoff point (not the food centroid).
   * APPROACH ends when this is ≤ `APPROACH_ARRIVE_MM`.
   */
  distanceToFood: number;
  /** Yaw toward the surface standoff. Falls back to `odorYaw` if omitted. */
  approachYaw?: number;
};

export type FeedingOutput = {
  state: FeedingState;
  clip: ClipName;
  heading: number;
  walk: number;
  pumpAmplitude: number;
  events: FeedingEvent[];
};

export class FeedingStateMachine {
  state: FeedingState = 'SEARCH';
  heading: number;
  time = 0;
  pumpCycles = 0;
  pumpTarget = 6;
  mn9HoldMs = 0;
  /** Reel path uses shorter phase dwells / fewer pump cycles. */
  fastConsume = false;
  private stateAge = 0;
  private pumpCycleT = 0;
  private approachNeeded = 3;
  private biteThisCycle = false;

  constructor(opts: { heading?: number } = {}) {
    this.heading = opts.heading ?? 0;
  }

  reset(heading = this.heading): void {
    this.state = 'SEARCH';
    this.heading = heading;
    this.time = 0;
    this.stateAge = 0;
    this.mn9HoldMs = 0;
    this.pumpCycles = 0;
    this.pumpCycleT = 0;
    this.pumpTarget = 6;
    this.approachNeeded = 3;
    this.biteThisCycle = false;
  }

  /** Spawn / re-seat already in TASTE range of a chunk. Does not skip the TASTE hold. */
  beginTaste(heading = this.heading): void {
    this.reset(heading);
    this.state = 'TASTE';
    this.stateAge = 0;
    this.mn9HoldMs = 0;
  }

  step(input: FeedingInput): FeedingOutput {
    const dt = Math.max(0, input.dt);
    this.time += dt;
    this.stateAge += dt;
    this.updateMn9Gate(input.mn9Rate, dt);

    const events: FeedingEvent[] = [];
    const enter = (next: FeedingState) => {
      if (next === this.state) return;
      const from = this.state;
      this.state = next;
      this.stateAge = 0;
      events.push({ type: 'transition', from, to: next, t: this.time });
      if (next === 'APPROACH') this.beginApproach(input.distanceToFood);
      if (next === 'PUMP') this.beginPump(input.mn9Rate);
      if (next === 'EXTEND' || next === 'TASTE') this.mn9HoldMs = next === 'EXTEND' ? this.mn9HoldMs : 0;
    };

    switch (this.state) {
      case 'SEARCH':
        if (input.odorStrength >= ODOR_DETECT) enter('ORIENT');
        break;
      case 'ORIENT':
        this.heading = turnToward(this.heading, input.odorYaw, dt, TURN_RATE_RAD_S);
        if (Math.abs(headingError(this.heading, input.odorYaw)) < HEADING_ALIGN_DEG * Math.PI / 180) {
          enter('APPROACH');
        }
        break;
      case 'APPROACH': {
        const yaw = input.approachYaw ?? input.odorYaw;
        this.heading = turnToward(this.heading, yaw, dt, TURN_RATE_RAD_S * 0.45);
        const aligned = Math.abs(headingError(this.heading, yaw)) < HEADING_ALIGN_DEG * Math.PI / 180;
        if (input.distanceToFood <= APPROACH_ARRIVE_MM && aligned && this.mayComplete()) enter('TASTE');
        break;
      }
      case 'TASTE':
        if (this.stateAge >= TASTE_MIN_S && this.mn9HoldMs >= MN9_HOLD_MS && this.mayComplete()) enter('EXTEND');
        else if (this.stateAge >= TASTE_TIMEOUT_S) enter('SEARCH');
        break;
      case 'EXTEND':
        if (this.stateAge >= CLIP_DURATION.per && this.mayComplete()) enter('PUMP');
        break;
      case 'PUMP': {
        this.pumpCycleT += dt;
        const period = 1 / PUMP_HZ;
        if (!this.biteThisCycle && this.pumpCycleT >= period * 0.5) {
          this.biteThisCycle = true;
          events.push({ type: 'bite', cycle: this.pumpCycles + 1, t: this.time });
        }
        if (this.pumpCycleT >= period) {
          this.pumpCycleT -= period;
          this.pumpCycles += 1;
          this.biteThisCycle = false;
        }
        // Interrupts (satiety, bitter) bypass the tempo floor; completion does not.
        if (input.satiety > SATIETY_RETRACT || input.bitter >= BITTER_RETRACT) enter('RETRACT');
        else if (this.pumpCycles >= this.pumpTarget && this.mayComplete()) enter('RETRACT');
        break;
      }
      case 'RETRACT':
        if (this.stateAge >= CLIP_DURATION.retract && this.mayComplete()) enter('REST');
        break;
      case 'REST':
        if (this.stateAge >= restDuration(input.satiety) && this.mayComplete()) enter('SEARCH');
        break;
    }

    const clip = clipForState(this.state, input.satiety);
    const walk = this.state === 'APPROACH' && input.distanceToFood > APPROACH_ARRIVE_MM ? 1 : 0;
    return {
      state: this.state,
      clip,
      heading: this.heading,
      walk,
      pumpAmplitude: pumpAmplitude(input.mn9Rate),
      events,
    };
  }

  private updateMn9Gate(mn9Rate: number, dt: number): void {
    if (mn9Rate >= MN9_EXTEND_HZ) this.mn9HoldMs += dt * 1000;
    else this.mn9HoldMs = 0;
  }

  /** Authored readability dwell (tempo.ts). Interrupt transitions do not call this. */
  private mayComplete(): boolean {
    return phaseMayComplete(this.state, this.stateAge, this.fastConsume ? PHASE_MIN_REEL_S : PHASE_MIN_S);
  }

  private beginApproach(distance: number): void {
    this.approachNeeded = clamp(Math.ceil(distance / STEP_LENGTH), 2, 4);
  }

  private beginPump(mn9Rate: number): void {
    this.pumpCycles = 0;
    this.pumpCycleT = 0;
    this.biteThisCycle = false;
    this.pumpTarget = pumpCycleCount(mn9Rate, this.fastConsume);
  }
}

/** Authored digest pause: 1.2 s hungry → 3.2 s sated. */
export function restDuration(satiety: number): number {
  return 1.2 + 2.0 * clamp01(satiety);
}

export function pumpAmplitude(mn9Rate: number): number {
  return clamp01((mn9Rate - 4) / 36);
}

/**
 * Cycles per bout scale with MN9 drive above threshold. 8–14 cycles at the
 * unchanged 6 Hz pump is 1.3–2.3 s of POMPUJ; each cycle is still one bite.
 */
export function pumpCycleCount(mn9Rate: number, fast = false): number {
  const min = fast ? PUMP_CYCLES_REEL_MIN : PUMP_CYCLES_MIN;
  const max = fast ? PUMP_CYCLES_REEL_MAX : PUMP_CYCLES_MAX;
  const span = max - min;
  return clamp(
    min + Math.round(span * clamp01((mn9Rate - MN9_EXTEND_HZ) / 40)),
    min,
    max,
  );
}
