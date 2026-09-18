/**
 * Macro scene loop ABOVE the feeding FSM. Inside EAT_SCOOP it hands control
 * to SEARCH→…→REST so the MN9 gate still decides when the proboscis extends.
 * Durations are soft caps; each state exits on its own completion flag.
 *
 * Default (`reel`): fly into tub → pick scoop → fly out to the table →
 * PUMP 1–3 bites → drop / groom → takeoff → mill land → biped walk →
 * AUTONOMOUS roam.
 * `?loop=full` keeps ORBIT / EXIT_FRAME. Authored motion — the
 * connectome is not consulted here. See docs/BODY-MODEL.md.
 */
import { Xoshiro128ss } from '../brain/rng.ts';
import { LOOP_CAPTIONS_PL } from '../hud/captions.ts';
import { GROOM_FULL_S, GROOM_SHORT_S, NAP_SATIETY, WAKE_S, canNap, napDuration } from './grooming.ts';
import { MILL_WALK_S } from './bipedGait.ts';
import { SCOOP_DROP_S, SCOOP_PICK_S } from './scoop.ts';

export const LOOP_STATES = [
  'ORBIT',
  'LAND_TOP',
  'WALK_SCOOP',
  'FLY_INTO_TUB',
  'PICK_SCOOP',
  'APPROACH_TUB',
  'DIP_SCOOP',
  'FLY_OUT_WITH_SCOOP',
  'EAT_SCOOP',
  'DROP_SCOOP',
  'GROOM_SHORT',
  'TAKEOFF_MILL',
  'ORBIT_SHORT',
  'LAND_MILL',
  'WALK_MILL',
  'WALK_BIPED',
  'WALK_BIPED_ON_MILL',
  'AUTONOMOUS',
  'GROOM_FULL',
  'NAP',
  'WAKE',
  'TAKEOFF_EXIT',
  'EXIT_FRAME',
] as const;

export type LoopState = (typeof LOOP_STATES)[number];

/** `reel` is the default scoop/mill loop. `full` is `?loop=full` (ORBIT / EXIT_FRAME). */
export type LoopVariant = 'reel' | 'full';

/** Safety-net duration for EAT_SCOOP. Bite count / satiety RETRACT exit earlier. */
export const EAT_BOUT_CAP_S = 6;
/** Loop-level bite cap. MN9 still gates each PUMP cycle; we only cap how many. */
export const EAT_SCOOP_MAX_BITES = 3;
export const EAT_SCOOP_MIN_BITES = 1;

export const FLY_INTO_TUB_S = 5.2;
export const FLY_OUT_SCOOP_S = 5.2;
/** Hexapod plant on the belt after LAND_MILL touchdown, before the biped gag. */
export const MILL_LAND_HEX_S = 2.0;

export type LoopFlags = {
  flightDone: boolean;
  walkDone: boolean;
  /** True after a feeding bout has reached REST (TASTE wait is never skipped). */
  eatBoutDone: boolean;
  groomDone: boolean;
  gagDone: boolean;
  napDone: boolean;
  wakeDone: boolean;
  propDone: boolean;
  satiety: number;
  cropVolume: number;
};

export type LoopOutput = {
  state: LoopState;
  age: number;
  gag: null;
  caption: string | null;
  orbitCircuits: number;
  eatKind: 'scoop' | null;
  advanced: boolean;
  /** Fresh portion: EXIT_FRAME→ORBIT (full) or AUTONOMOUS wrap. */
  wrapped: boolean;
};

const CAP: Record<LoopState, number> = {
  ORBIT: 22,
  LAND_TOP: 8,
  WALK_SCOOP: 8,
  FLY_INTO_TUB: FLY_INTO_TUB_S,
  PICK_SCOOP: SCOOP_PICK_S + 0.35,
  APPROACH_TUB: 8,
  DIP_SCOOP: 1.5,
  FLY_OUT_WITH_SCOOP: FLY_OUT_SCOOP_S,
  EAT_SCOOP: EAT_BOUT_CAP_S,
  DROP_SCOOP: SCOOP_DROP_S + 0.4,
  GROOM_SHORT: GROOM_SHORT_S + 0.4,
  TAKEOFF_MILL: 2.2,
  ORBIT_SHORT: 14,
  LAND_MILL: 8,
  WALK_MILL: MILL_WALK_S + 0.4,
  WALK_BIPED: MILL_WALK_S + 0.4,
  WALK_BIPED_ON_MILL: MILL_WALK_S + 0.4,
  AUTONOMOUS: 1e9,
  GROOM_FULL: GROOM_FULL_S + 0.4,
  NAP: 20,
  WAKE: WAKE_S + 0.3,
  TAKEOFF_EXIT: 2.2,
  EXIT_FRAME: 1.6,
};

function eatKind(state: LoopState): 'scoop' | null {
  return state === 'EAT_SCOOP' ? 'scoop' : null;
}

function initialState(variant: LoopVariant): LoopState {
  return variant === 'full' ? 'ORBIT' : 'FLY_INTO_TUB';
}

export class SceneLoop {
  readonly variant: LoopVariant;
  state: LoopState;
  age = 0;
  gag: null = null;
  orbitCircuits = 2;
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
  }

  step(dt: number, flags: LoopFlags): LoopOutput {
    this.age += Math.max(0, dt);
    this.wrappedThisStep = false;
    if (this.state === 'EAT_SCOOP' && flags.eatBoutDone) this.sweetBout = true;
    const cap = this.state === 'NAP'
      ? napDuration(flags.satiety) + 0.3
      : CAP[this.state];
    let advanced = false;
    if (this.state !== 'AUTONOMOUS' && (this.finished(flags) || this.age >= cap)) {
      this.advance(flags);
      advanced = true;
    }
    return {
      state: this.state,
      age: this.age,
      gag: null,
      caption: LOOP_CAPTIONS_PL[this.state] ?? null,
      orbitCircuits: this.state === 'ORBIT_SHORT' ? 1 : this.orbitCircuits,
      eatKind: eatKind(this.state),
      advanced,
      wrapped: this.wrappedThisStep,
    };
  }

  private finished(flags: LoopFlags): boolean {
    if (this.age < 0.05) return false;
    switch (this.state) {
      case 'ORBIT':
      case 'ORBIT_SHORT':
      case 'LAND_TOP':
      case 'TAKEOFF_MILL':
      case 'TAKEOFF_EXIT':
      case 'EXIT_FRAME':
      case 'FLY_INTO_TUB':
      case 'FLY_OUT_WITH_SCOOP':
        return flags.flightDone;
      case 'WALK_SCOOP':
      case 'APPROACH_TUB':
        return flags.walkDone;
      case 'LAND_MILL':
        return flags.flightDone && flags.propDone;
      case 'PICK_SCOOP':
      case 'DIP_SCOOP':
      case 'DROP_SCOOP':
      case 'WALK_MILL':
      case 'WALK_BIPED':
      case 'WALK_BIPED_ON_MILL':
        return flags.propDone;
      case 'EAT_SCOOP':
        return flags.eatBoutDone;
      case 'GROOM_SHORT':
      case 'GROOM_FULL':
        return flags.groomDone;
      case 'NAP':
        return flags.napDone;
      case 'WAKE':
        return flags.wakeDone;
      case 'AUTONOMOUS':
        return false;
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
    void NAP_SATIETY;
  }

  private nextFull(from: LoopState, flags: LoopFlags): LoopState {
    switch (from) {
      case 'ORBIT': return 'LAND_TOP';
      case 'LAND_TOP': return 'FLY_INTO_TUB';
      case 'FLY_INTO_TUB': return 'PICK_SCOOP';
      case 'WALK_SCOOP': return 'FLY_INTO_TUB';
      case 'PICK_SCOOP': return 'EAT_SCOOP';
      case 'APPROACH_TUB': return 'PICK_SCOOP';
      case 'DIP_SCOOP': return 'EAT_SCOOP';
      case 'EAT_SCOOP': return 'FLY_OUT_WITH_SCOOP';
      case 'FLY_OUT_WITH_SCOOP': return 'LAND_MILL';
      case 'DROP_SCOOP': return 'EAT_SCOOP';
      case 'GROOM_SHORT': return 'TAKEOFF_MILL';
      case 'TAKEOFF_MILL': return 'ORBIT_SHORT';
      case 'ORBIT_SHORT': return 'LAND_MILL';
      case 'LAND_MILL': return 'WALK_BIPED_ON_MILL';
      case 'WALK_MILL': return 'WALK_BIPED_ON_MILL';
      case 'WALK_BIPED': return 'GROOM_FULL';
      case 'WALK_BIPED_ON_MILL': return 'GROOM_FULL';
      case 'AUTONOMOUS': return 'GROOM_FULL';
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
      case 'FLY_INTO_TUB': return 'PICK_SCOOP';
      case 'WALK_SCOOP': return 'FLY_INTO_TUB';
      case 'PICK_SCOOP': return 'FLY_OUT_WITH_SCOOP';
      case 'APPROACH_TUB': return 'PICK_SCOOP';
      case 'DIP_SCOOP': return 'EAT_SCOOP';
      case 'EAT_SCOOP': return 'DROP_SCOOP';
      case 'FLY_OUT_WITH_SCOOP': return 'EAT_SCOOP';
      case 'DROP_SCOOP': return 'GROOM_SHORT';
      case 'GROOM_SHORT': return 'TAKEOFF_MILL';
      case 'TAKEOFF_MILL': return 'LAND_MILL';
      case 'LAND_MILL': return 'WALK_BIPED_ON_MILL';
      case 'WALK_MILL': return 'WALK_BIPED_ON_MILL';
      case 'WALK_BIPED': return 'AUTONOMOUS';
      case 'WALK_BIPED_ON_MILL': return 'AUTONOMOUS';
      case 'AUTONOMOUS': return 'AUTONOMOUS';
      case 'GROOM_FULL': return 'AUTONOMOUS';
      case 'NAP': return 'WAKE';
      case 'WAKE': return 'FLY_INTO_TUB';
      case 'ORBIT': return 'LAND_TOP';
      case 'LAND_TOP': return 'FLY_INTO_TUB';
      case 'ORBIT_SHORT': return 'LAND_MILL';
      case 'TAKEOFF_EXIT': return 'EXIT_FRAME';
      case 'EXIT_FRAME': return 'FLY_INTO_TUB';
    }
  }
}

export function isEatState(state: LoopState): boolean {
  return state === 'EAT_SCOOP';
}

export function isFlightState(state: LoopState): boolean {
  return state === 'ORBIT' || state === 'ORBIT_SHORT' || state === 'LAND_TOP'
    || state === 'LAND_MILL' || state === 'TAKEOFF_MILL' || state === 'TAKEOFF_EXIT'
    || state === 'EXIT_FRAME' || state === 'FLY_INTO_TUB' || state === 'FLY_OUT_WITH_SCOOP';
}

export function isWalkState(state: LoopState): boolean {
  return state === 'WALK_SCOOP' || state === 'APPROACH_TUB';
}

export function isPropState(state: LoopState): boolean {
  return state === 'PICK_SCOOP' || state === 'DIP_SCOOP' || state === 'DROP_SCOOP'
    || state === 'WALK_MILL' || state === 'WALK_BIPED' || state === 'WALK_BIPED_ON_MILL';
}

export function isMillState(state: LoopState): boolean {
  return state === 'WALK_MILL' || state === 'WALK_BIPED' || state === 'WALK_BIPED_ON_MILL'
    || state === 'LAND_MILL';
}

export function isSplineFlight(state: LoopState): boolean {
  return state === 'FLY_INTO_TUB' || state === 'FLY_OUT_WITH_SCOOP';
}
