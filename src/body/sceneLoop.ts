/**
 * Macro scene loop ABOVE the feeding FSM. Inside EAT it hands control to
 * SEARCH→…→REST so the MN9 gate still decides when the proboscis extends.
 * Durations are soft caps; each state exits on its own completion flag.
 *
 * Default (`reel`): she lives on the twaróg. Flight is punctuation — one
 * TAKEOFF_1 per portion to switch top→side, plus the escapeShadow gag.
 * `?loop=full` keeps the debug ORBIT / EXIT_FRAME path. Flight code stays.
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
  'WALK_REPOSITION',
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

/** `reel` is the default on-food loop. `full` is `?loop=full` (ORBIT / EXIT_FRAME). */
export type LoopVariant = 'reel' | 'full';

/** Hard cap for EAT_TOP / EAT_SIDE / EAT_SIDE_2. Satiety-driven RETRACT can exit earlier. */
export const EAT_BOUT_CAP_S = 45;

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
  /** Fresh portion: EXIT_FRAME→ORBIT (full) or WAKE/WALK→EAT_TOP (reel). */
  wrapped: boolean;
};

const CAP: Record<LoopState, number> = {
  ORBIT: 22,
  LAND_TOP: 8,
  WALK_TOP: 5,
  WALK_REPOSITION: 5,
  EAT_TOP: EAT_BOUT_CAP_S,
  GROOM_SHORT: GROOM_SHORT_S + 0.4,
  TAKEOFF_1: 2.2,
  ORBIT_SHORT: 14,
  LAND_TABLE: 8,
  EAT_SIDE: EAT_BOUT_CAP_S,
  GAG: 20,
  EAT_SIDE_2: EAT_BOUT_CAP_S,
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

function initialState(variant: LoopVariant): LoopState {
  return variant === 'full' ? 'ORBIT' : 'EAT_TOP';
}

export class SceneLoop {
  readonly variant: LoopVariant;
  state: LoopState;
  age = 0;
  gag: GagId | null = null;
  orbitCircuits = 2;
  /** One voluntary TAKEOFF_1 per portion (top → side). Reel only. */
  faceSwitched = false;
  private rng: Xoshiro128ss;
  private sweetBout = false;
  private wrappedThisStep = false;

  constructor(seed = 1, variant: LoopVariant = 'reel') {
    this.variant = variant;
    this.rng = new Xoshiro128ss(seed);
    this.state = initialState(variant);
    this.roll(seed);
  }

  reset(seed: number): void {
    this.rng = new Xoshiro128ss(seed);
    this.roll(seed);
    this.state = initialState(this.variant);
    this.age = 0;
    this.sweetBout = false;
    this.faceSwitched = false;
  }

  private roll(seed: number): void {
    const rng = new Xoshiro128ss(seed ^ 0x9e3779b9);
    this.orbitCircuits = rng.nextFloat() < 0.5 ? 2 : 3;
    this.gag = null;
  }

  step(dt: number, flags: LoopFlags): LoopOutput {
    this.age += Math.max(0, dt);
    this.wrappedThisStep = false;
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
      wrapped: this.wrappedThisStep,
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
      case 'WALK_REPOSITION':
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
    const next = this.variant === 'full' ? this.nextFull(from, flags) : this.nextReel(from, flags);
    this.state = next;
    this.age = 0;
    if (this.variant === 'full' && next === 'ORBIT' && from === 'EXIT_FRAME') {
      this.roll(this.rng.nextUint32());
      this.sweetBout = false;
      this.wrappedThisStep = true;
    }
    if (
      this.variant === 'reel'
      && next === 'EAT_TOP'
      && (from === 'WAKE' || from === 'WALK_REPOSITION')
    ) {
      this.roll(this.rng.nextUint32());
      this.sweetBout = false;
      this.faceSwitched = false;
      this.wrappedThisStep = true;
    }
    void NAP_SATIETY;
  }

  private nextFull(from: LoopState, flags: LoopFlags): LoopState {
    switch (from) {
      case 'ORBIT': return 'LAND_TOP';
      case 'LAND_TOP': return 'WALK_TOP';
      case 'WALK_TOP': return 'EAT_TOP';
      case 'WALK_REPOSITION': return 'EAT_TOP';
      case 'EAT_TOP': return 'GROOM_SHORT';
      case 'GROOM_SHORT': return 'TAKEOFF_1';
      case 'TAKEOFF_1': return 'ORBIT_SHORT';
      case 'ORBIT_SHORT': return 'LAND_TABLE';
      case 'LAND_TABLE': return 'EAT_SIDE';
      case 'EAT_SIDE':
        this.gag = pickGag(this.rng, { satiety: flags.satiety, cropVolume: flags.cropVolume });
        return this.gag ? 'GAG' : 'EAT_SIDE_2';
      case 'GAG': return 'EAT_SIDE_2';
      case 'EAT_SIDE_2': return 'GROOM_FULL';
      case 'GROOM_FULL':
        return this.sweetBout && canNap(flags.satiety) ? 'NAP' : 'TAKEOFF_EXIT';
      case 'NAP': return 'WAKE';
      case 'WAKE': return 'TAKEOFF_EXIT';
      case 'TAKEOFF_EXIT': return 'EXIT_FRAME';
      case 'EXIT_FRAME': return 'ORBIT';
    }
  }

  private nextReel(from: LoopState, flags: LoopFlags): LoopState {
    switch (from) {
      case 'EAT_TOP': return 'GROOM_SHORT';
      case 'GROOM_SHORT': return 'WALK_REPOSITION';
      case 'WALK_REPOSITION':
        if (!this.faceSwitched) return 'TAKEOFF_1';
        return this.sweetBout && canNap(flags.satiety) ? 'NAP' : 'EAT_TOP';
      case 'TAKEOFF_1':
        this.faceSwitched = true;
        return 'LAND_TABLE';
      case 'LAND_TABLE': return 'EAT_SIDE';
      case 'EAT_SIDE':
        this.gag = pickGag(this.rng, { satiety: flags.satiety, cropVolume: flags.cropVolume });
        return this.gag ? 'GAG' : 'GROOM_FULL';
      case 'GAG': return 'GROOM_FULL';
      case 'GROOM_FULL': return 'WALK_REPOSITION';
      case 'NAP': return 'WAKE';
      case 'WAKE': return 'EAT_TOP';
      // Kept reachable so a mid-session `?loop=full` hand-off cannot stall.
      case 'ORBIT': return 'LAND_TOP';
      case 'LAND_TOP': return 'WALK_TOP';
      case 'WALK_TOP': return 'EAT_TOP';
      case 'ORBIT_SHORT': return 'LAND_TABLE';
      case 'EAT_SIDE_2': return 'GROOM_FULL';
      case 'TAKEOFF_EXIT': return 'EXIT_FRAME';
      case 'EXIT_FRAME': return 'EAT_TOP';
    }
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

export function isWalkState(state: LoopState): boolean {
  return state === 'WALK_TOP' || state === 'WALK_REPOSITION';
}
