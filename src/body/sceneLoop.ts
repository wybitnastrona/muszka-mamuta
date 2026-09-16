/**
 * Macro scene loop ABOVE the feeding FSM. Inside EAT it hands control to
 * SEARCH→…→REST so the MN9 gate still decides when the proboscis extends.
 * Durations are soft caps; each state exits on its own completion flag.
 *
 * Authored motion. The connectome is not consulted here. See docs/BODY-MODEL.md.
 */
import { Xoshiro128ss } from '../brain/rng.ts';
import { LOOP_CAPTIONS_PL } from '../hud/captions.ts';
import { GROOM_FULL_S, GROOM_SHORT_S, NAP_SATIETY, WAKE_S, canNap, napDuration } from './grooming.ts';
import { GAG_DURATION_CAP, type GagId, pickGag } from './gags.ts';

export const LOOP_STATES = [
  'ORBIT',
  'LAND_TOP',
  'WALK_TOP',
  'EAT_TOP',
  'GROOM_SHORT',
  'TAKEOFF_1',
  'ORBIT_SHORT',
  'LAND_TABLE',
  'EAT_SIDE',
  'GAG',
  'EAT_SIDE_2',
  'GROOM_FULL',
  'NAP',
  'WAKE',
  'TAKEOFF_EXIT',
  'EXIT_FRAME',
] as const;

export type LoopState = (typeof LOOP_STATES)[number];

export type LoopFlags = {
  flightDone: boolean;
  walkDone: boolean;
  /** True after a feeding bout has reached REST (TASTE wait is never skipped). */
  eatBoutDone: boolean;
  groomDone: boolean;
  gagDone: boolean;
  napDone: boolean;
  wakeDone: boolean;
  satiety: number;
  cropVolume: number;
};

export type LoopOutput = {
  state: LoopState;
  age: number;
  gag: GagId | null;
  caption: string | null;
  orbitCircuits: number;
  eatKind: 'top' | 'side' | null;
  advanced: boolean;
};

const CAP: Record<LoopState, number> = {
  ORBIT: 22,
  LAND_TOP: 8,
  WALK_TOP: 5,
  EAT_TOP: 28,
  GROOM_SHORT: GROOM_SHORT_S + 0.4,
  TAKEOFF_1: 2.2,
  ORBIT_SHORT: 14,
  LAND_TABLE: 8,
  EAT_SIDE: 28,
  GAG: 20,
  EAT_SIDE_2: 28,
  GROOM_FULL: GROOM_FULL_S + 0.4,
  NAP: 20,
  WAKE: WAKE_S + 0.3,
  TAKEOFF_EXIT: 2.2,
  EXIT_FRAME: 1.6,
};

function eatKind(state: LoopState): 'top' | 'side' | null {
  if (state === 'EAT_TOP') return 'top';
  if (state === 'EAT_SIDE' || state === 'EAT_SIDE_2') return 'side';
  return null;
}

export class SceneLoop {
  state: LoopState = 'ORBIT';
  age = 0;
  gag: GagId | null = null;
  orbitCircuits = 2;
  private rng: Xoshiro128ss;
  private sweetBout = false;

  constructor(seed = 1) {
    this.rng = new Xoshiro128ss(seed);
    this.roll(seed);
  }

  reset(seed: number): void {
    this.rng = new Xoshiro128ss(seed);
    this.roll(seed);
    this.state = 'ORBIT';
    this.age = 0;
    this.sweetBout = false;
  }

  private roll(seed: number): void {
    const rng = new Xoshiro128ss(seed ^ 0x9e3779b9);
    this.orbitCircuits = rng.nextFloat() < 0.5 ? 2 : 3;
    this.gag = null;
  }

  step(dt: number, flags: LoopFlags): LoopOutput {
    this.age += Math.max(0, dt);
    if (this.state === 'EAT_TOP' || this.state === 'EAT_SIDE' || this.state === 'EAT_SIDE_2') {
      if (flags.eatBoutDone) this.sweetBout = true;
    }
    const cap = this.state === 'GAG' && this.gag
      ? GAG_DURATION_CAP[this.gag] + 0.4
      : this.state === 'NAP'
        ? napDuration(flags.satiety) + 0.3
        : CAP[this.state];
    let advanced = false;
    if (this.finished(flags) || this.age >= cap) {
      this.advance(flags);
      advanced = true;
    }
    return {
      state: this.state,
      age: this.age,
      gag: this.gag,
      caption: LOOP_CAPTIONS_PL[this.state] ?? null,
      orbitCircuits: this.state === 'ORBIT_SHORT' ? 1 : this.orbitCircuits,
      eatKind: eatKind(this.state),
      advanced,
    };
  }

  private finished(flags: LoopFlags): boolean {
    if (this.age < 0.05 && !(this.state === 'GAG' && this.gag === null)) return false;
    switch (this.state) {
      case 'ORBIT':
      case 'ORBIT_SHORT':
      case 'LAND_TOP':
      case 'LAND_TABLE':
      case 'TAKEOFF_1':
      case 'TAKEOFF_EXIT':
      case 'EXIT_FRAME':
        return flags.flightDone;
      case 'WALK_TOP':
        return flags.walkDone;
      case 'EAT_TOP':
      case 'EAT_SIDE':
      case 'EAT_SIDE_2':
        return flags.eatBoutDone;
      case 'GROOM_SHORT':
      case 'GROOM_FULL':
        return flags.groomDone;
      case 'GAG':
        return this.gag === null || flags.gagDone;
      case 'NAP':
        return flags.napDone;
      case 'WAKE':
        return flags.wakeDone;
    }
  }

  private advance(flags: LoopFlags): void {
    const from = this.state;
    let next: LoopState;
    switch (from) {
      case 'ORBIT': next = 'LAND_TOP'; break;
      case 'LAND_TOP': next = 'WALK_TOP'; break;
      case 'WALK_TOP': next = 'EAT_TOP'; break;
      case 'EAT_TOP': next = 'GROOM_SHORT'; break;
      case 'GROOM_SHORT': next = 'TAKEOFF_1'; break;
      case 'TAKEOFF_1': next = 'ORBIT_SHORT'; break;
      case 'ORBIT_SHORT': next = 'LAND_TABLE'; break;
      case 'LAND_TABLE': next = 'EAT_SIDE'; break;
      case 'EAT_SIDE':
        // Entry conditions (courtship satiety, tooFull crop) are live here —
        // after the first eating bout, not a fake value from loop start.
        this.gag = pickGag(this.rng, { satiety: flags.satiety, cropVolume: flags.cropVolume });
        next = this.gag ? 'GAG' : 'EAT_SIDE_2';
        break;
      case 'GAG': next = 'EAT_SIDE_2'; break;
      case 'EAT_SIDE_2': next = 'GROOM_FULL'; break;
      case 'GROOM_FULL':
        next = this.sweetBout && canNap(flags.satiety) ? 'NAP' : 'TAKEOFF_EXIT';
        break;
      case 'NAP': next = 'WAKE'; break;
      case 'WAKE': next = 'TAKEOFF_EXIT'; break;
      case 'TAKEOFF_EXIT': next = 'EXIT_FRAME'; break;
      case 'EXIT_FRAME': next = 'ORBIT'; break;
    }
    this.state = next;
    this.age = 0;
    if (next === 'ORBIT' && from === 'EXIT_FRAME') {
      this.roll(this.rng.nextUint32());
      this.sweetBout = false;
    }
    void NAP_SATIETY;
  }
}

export function isEatState(state: LoopState): boolean {
  return state === 'EAT_TOP' || state === 'EAT_SIDE' || state === 'EAT_SIDE_2';
}

export function isFlightState(state: LoopState): boolean {
  return state === 'ORBIT' || state === 'ORBIT_SHORT' || state === 'LAND_TOP'
    || state === 'LAND_TABLE' || state === 'TAKEOFF_1' || state === 'TAKEOFF_EXIT'
    || state === 'EXIT_FRAME';
}
