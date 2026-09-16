import type { ClipName, FeedingEvent, FeedingState } from './types.ts';
import { headingError, turnToward, clamp, clamp01 } from './math.ts';
import { CLIP_DURATION, PUMP_HZ, clipForState } from './feedingMotion.ts';
import { ODOR_DETECT } from './odorField.ts';

export const HEADING_ALIGN_DEG = 15;
export const MN9_EXTEND_HZ = 8;
export const MN9_HOLD_MS = 80;
export const SATIETY_RETRACT = 0.85;
export const BITTER_RETRACT = 0.12;
export const TURN_RATE_RAD_S = 2.4;
export const NEAR_FOOD = 0.055;
export const STEP_LENGTH = 0.038;
export const TASTE_MIN_S = 0.25;
export const TASTE_TIMEOUT_S = 1.6;
export const GROOM_SATIETY = 0.7;

export type FeedingInput = {
  dt: number;
  mn9Rate: number;
  bitter: number;
  satiety: number;
  odorYaw: number;
  odorStrength: number;
  distanceToFood: number;
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
  private stateAge = 0;
  private mn9HoldMs = 0;
  private pumpCycles = 0;
  private pumpCycleT = 0;
  private pumpTarget = 2;
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
    this.pumpTarget = 2;
    this.approachNeeded = 3;
    this.biteThisCycle = false;
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
      case 'APPROACH':
        this.heading = turnToward(this.heading, input.odorYaw, dt, TURN_RATE_RAD_S * 0.45);
        if (input.distanceToFood <= NEAR_FOOD) enter('TASTE');
        else if (this.stateAge >= this.approachNeeded * (CLIP_DURATION.approach / 3)) enter('TASTE');
        break;
      case 'TASTE':
        if (this.stateAge >= TASTE_MIN_S && this.mn9HoldMs >= MN9_HOLD_MS) enter('EXTEND');
        else if (this.stateAge >= TASTE_TIMEOUT_S) enter('SEARCH');
        break;
      case 'EXTEND':
        if (this.stateAge >= CLIP_DURATION.per) enter('PUMP');
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
        if (input.satiety > SATIETY_RETRACT || input.bitter >= BITTER_RETRACT) enter('RETRACT');
        else if (this.pumpCycles >= this.pumpTarget) enter('RETRACT');
        break;
      }
      case 'RETRACT':
        if (this.stateAge >= CLIP_DURATION.retract) enter('REST');
        break;
      case 'REST':
        if (this.stateAge >= restDuration(input.satiety)) enter('SEARCH');
        break;
    }

    const clip = clipForState(this.state, input.satiety);
    const walk = this.state === 'APPROACH' ? 1 : 0;
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

  private beginApproach(distance: number): void {
    this.approachNeeded = clamp(Math.ceil(distance / STEP_LENGTH), 2, 4);
  }

  private beginPump(mn9Rate: number): void {
    this.pumpCycles = 0;
    this.pumpCycleT = 0;
    this.biteThisCycle = false;
    this.pumpTarget = clamp(2 + Math.round(3 * clamp01((mn9Rate - MN9_EXTEND_HZ) / 40)), 2, 5);
  }
}

export function restDuration(satiety: number): number {
  return 0.35 + 1.45 * clamp01(satiety);
}

export function pumpAmplitude(mn9Rate: number): number {
  return clamp01((mn9Rate - 4) / 36);
}

export function pumpCycleCount(mn9Rate: number): number {
  return clamp(2 + Math.round(3 * clamp01((mn9Rate - MN9_EXTEND_HZ) / 40)), 2, 5);
}
