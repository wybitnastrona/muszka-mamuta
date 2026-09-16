/**
 * Authored hemolymph / gut model. Not connectome data.
 *
 * Stepped once per animation frame on the main thread (cheap ODEs; the 20k
 * LIF stays in the worker). Every symbol below is an authored constant.
 *
 * MaleCNS provides no sweet/bitter receptor split. Hunger therefore modulates
 * the whole gustatory channel via `getModulation().gustGain` (see
 * `modulation.ts`). Circuit inhibition is the GABA/glutamate already in the
 * extracted graph — this file does not invent a bitter pathway.
 *
 * Vanilla-sweetened twaróg (`TWAROG_MAMUTA_WANILIOWY`) yields ~3× the
 * trehalose of unsweetened curd (`sweet: 0.15`). Fast sugar → insulin/satiety
 * cuts a bout short; baseline trehalose drain then restores AKH while fat
 * (from `aa`) moves slowly → shorter feeding bouts, more of them.
 */

import { FRAME_MS, clamp01 } from '../brain/params.ts';
import {
  TWAROG_MAMUTA_WANILIOWY,
  type FoodProfile,
} from '../food/foodProfile.ts';

export type HemolymphState = {
  trehalose: number;
  fat: number;
  cropVolume: number;
  gutLoad: number;
  water: number;
  akh: number;
  dsk: number;
  insulin: number;
};

export type Modulation = {
  gustGain: number;
  mn9ThresholdShift: number;
};

export type DefecationEvent = {
  timeSec: number;
  mass: number;
  /** Table coordinates in [0, 1], deterministic from event index. */
  x: number;
  y: number;
};

export type MassLedger = {
  ingested: number;
  crop: number;
  gut: number;
  absorbed: number;
  defecated: number;
};

/** Baseline trehalose drain (1/s). ~0.43 units in 90 min. */
export const K_TREHALOSE_MET = 8e-5;

/** Slow fat drain (1/s). */
export const K_FAT_MET = 2e-5;

/** Water loss (1/s). */
export const K_WATER_LOSS = 1.2e-5;

/** Crop → gut transfer, volume units / s. Full crop (~1) empties in ~8 s. */
export const CROP_EMPTY_RATE = 0.12;

/** Fractional gut absorption rate (1/s). */
export const ABSORB_RATE = 0.02;

/** Default bite volume (crop units). */
export const BITE_MASS = 0.08;

/** Gut fill that triggers a defecation dump. */
export const GUT_FULL = 0.85;

/** Volume removed when the gut dumps. */
export const DEFECATE_MASS = 0.4;

/**
 * trehalose_yield = BASE + PER_SWEET × sweet.
 * Vanilla 0.75 vs plain 0.15 → (0.15+0.75)/(0.15+0.15) = 3.
 */
export const TREHALOSE_YIELD_BASE = 0.15;
export const TREHALOSE_YIELD_PER_SWEET = 1;

/** fat_yield = PER_AA × aa. Same `aa` on vanilla and plain → same fat gain. */
export const FAT_YIELD_PER_AA = 0.55;

export const WATER_FROM_FOOD = 0.35;

/** AKH = σ((θ − trehalose) / k). Authored sigmoid, not a measured AKH curve. */
export const AKH_THETA = 0.45;
export const AKH_K = 0.12;
export const TAU_AKH_S = 8;

/** DSK tracks gut fill (stretch) plus a little fat. */
export const DSK_THETA = 0.35;
export const DSK_K = 0.12;
export const TAU_DSK_S = 25;

/** Insulin tracks trehalose (fast sugar satiety). Rest trehalose 0.5 sits below this. */
export const INSULIN_THETA = 0.55;
export const INSULIN_K = 0.08;
export const TAU_INSULIN_S = 18;

export const SATIETY_INSULIN = 0.5;
export const SATIETY_DSK = 0.25;
export const SATIETY_FAT = 0.25;
export const HUNGER_SATIETY_SUPPRESS = 0.7;

/** gustGain = GAIN_0 + GAIN_H × hungerDrive. At hunger 0.4, gain = 1 (rest). */
export const GUST_GAIN_0 = 0.7;
export const GUST_GAIN_H = 0.75;

/**
 * mn9ThresholdShift mV = SHIFT_0 + SHIFT_H × hungerDrive.
 * At hunger 0.4, shift = 0 so calibrated MN9 rest is unchanged.
 * Hungry: negative (easier spike). Sated: positive (harder).
 */
export const MN9_SHIFT_0_MV = 1.2;
export const MN9_SHIFT_H_MV = -3;

export const CROP_EATING_WEIGHT = 0.5;
export const SATIETY_EATING_WEIGHT = 0.85;

export const INITIAL_STATE: HemolymphState = {
  trehalose: 0.5,
  fat: 0.4,
  cropVolume: 0,
  gutLoad: 0,
  water: 0.65,
  akh: 0,
  dsk: 0,
  insulin: 0,
};

export type HemolymphOptions = {
  profile?: FoodProfile;
  /** Cosmetic table spots. Default off — defecation mass still leaves the gut. */
  spotsEnabled?: boolean;
};

export function sigmoid(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

export function trehaloseYield(profile: FoodProfile): number {
  return TREHALOSE_YIELD_BASE + TREHALOSE_YIELD_PER_SWEET * profile.sweet;
}

export function fatYield(profile: FoodProfile): number {
  return FAT_YIELD_PER_AA * profile.aa;
}

function approach(current: number, target: number, dt: number, tau: number): number {
  if (dt <= 0) return current;
  const a = 1 - Math.exp(-dt / tau);
  return current + (target - current) * a;
}

function spotXY(index: number): { x: number; y: number } {
  return {
    x: 0.22 + 0.56 * ((index * 0.6180339887) % 1),
    y: 0.38 + 0.4 * ((index * 0.3819660113) % 1),
  };
}

export class Hemolymph {
  readonly profile: FoodProfile;
  spotsEnabled: boolean;
  private s: HemolymphState;
  private t = 0;
  private ingested = 0;
  private absorbed = 0;
  private defecated = 0;
  private dumpIndex = 0;
  private readonly spotsInternal: DefecationEvent[] = [];

  constructor(opts: HemolymphOptions = {}) {
    this.profile = opts.profile ?? TWAROG_MAMUTA_WANILIOWY;
    this.spotsEnabled = opts.spotsEnabled ?? false;
    this.s = { ...INITIAL_STATE };
    this.reset();
  }

  reset(): void {
    this.s = { ...INITIAL_STATE };
    this.t = 0;
    this.ingested = 0;
    this.absorbed = 0;
    this.defecated = 0;
    this.dumpIndex = 0;
    this.spotsInternal.length = 0;
    this.s.akh = sigmoid((AKH_THETA - this.s.trehalose) / AKH_K);
    this.s.dsk = sigmoid((this.s.gutLoad + 0.15 * this.s.fat - DSK_THETA) / DSK_K);
    this.s.insulin = sigmoid((this.s.trehalose - INSULIN_THETA) / INSULIN_K);
  }

  get timeSec(): number {
    return this.t;
  }

  get state(): HemolymphState {
    return { ...this.s };
  }

  get spots(): readonly DefecationEvent[] {
    return this.spotsInternal;
  }

  get massLedger(): MassLedger {
    return {
      ingested: this.ingested,
      crop: this.s.cropVolume,
      gut: this.s.gutLoad,
      absorbed: this.absorbed,
      defecated: this.defecated,
    };
  }

  get satiety(): number {
    return clamp01(
      SATIETY_INSULIN * this.s.insulin + SATIETY_DSK * this.s.dsk + SATIETY_FAT * this.s.fat,
    );
  }

  /** AKH after satiety suppression. Authored, 0..1. */
  get hungerDrive(): number {
    return clamp01(this.s.akh * (1 - HUNGER_SATIETY_SUPPRESS * this.satiety));
  }

  /**
   * Probability a controller would take a bite this frame. Deterministic
   * value — this class does not sample it.
   */
  get eatingProbability(): number {
    const cropFactor = 1 - CROP_EATING_WEIGHT * this.s.cropVolume;
    const satietyFactor = 1 - SATIETY_EATING_WEIGHT * this.satiety;
    return clamp01(this.hungerDrive * cropFactor * satietyFactor);
  }

  getModulation(): Modulation {
    const h = this.hungerDrive;
    return {
      gustGain: GUST_GAIN_0 + GUST_GAIN_H * h,
      mn9ThresholdShift: MN9_SHIFT_0_MV + MN9_SHIFT_H_MV * h,
    };
  }

  hud(): {
    trehalose: number;
    hungerDrive: number;
    satiety: number;
    cropVolume: number;
    gutLoad: number;
    eatingProbability: number;
  } {
    const s = this.s;
    return {
      trehalose: s.trehalose,
      hungerDrive: this.hungerDrive,
      satiety: this.satiety,
      cropVolume: s.cropVolume,
      gutLoad: s.gutLoad,
      eatingProbability: this.eatingProbability,
    };
  }

  /** Add food to the crop. Returns the volume actually accepted (crop is capped at 1). */
  bite(mass = BITE_MASS): number {
    const added = Math.max(0, Math.min(mass, 1 - this.s.cropVolume));
    this.s.cropVolume += added;
    this.ingested += added;
    return added;
  }

  /** Advance the ODEs. `dtSec` defaults to one 60 fps frame. */
  step(dtSec = FRAME_MS / 1000): DefecationEvent[] {
    const dt = Math.max(0, dtSec);
    if (dt === 0) return [];
    this.t += dt;
    const s = this.s;
    const events: DefecationEvent[] = [];

    s.trehalose = clamp01(s.trehalose - K_TREHALOSE_MET * dt);
    s.fat = clamp01(s.fat - K_FAT_MET * dt);
    s.water = clamp01(s.water - K_WATER_LOSS * dt);

    const transfer = Math.min(s.cropVolume, CROP_EMPTY_RATE * dt, 1 - s.gutLoad);
    s.cropVolume -= transfer;
    s.gutLoad += transfer;

    const absorbed = Math.min(s.gutLoad, s.gutLoad * ABSORB_RATE * dt);
    s.gutLoad -= absorbed;
    this.absorbed += absorbed;
    s.trehalose = clamp01(s.trehalose + absorbed * trehaloseYield(this.profile));
    s.fat = clamp01(s.fat + absorbed * fatYield(this.profile));
    s.water = clamp01(s.water + absorbed * WATER_FROM_FOOD);

    s.akh = clamp01(approach(s.akh, sigmoid((AKH_THETA - s.trehalose) / AKH_K), dt, TAU_AKH_S));
    s.dsk = clamp01(
      approach(s.dsk, sigmoid((s.gutLoad + 0.15 * s.fat - DSK_THETA) / DSK_K), dt, TAU_DSK_S),
    );
    s.insulin = clamp01(
      approach(s.insulin, sigmoid((s.trehalose - INSULIN_THETA) / INSULIN_K), dt, TAU_INSULIN_S),
    );

    if (s.gutLoad >= GUT_FULL) {
      const dumped = Math.min(s.gutLoad, DEFECATE_MASS);
      s.gutLoad -= dumped;
      this.defecated += dumped;
      const { x, y } = spotXY(this.dumpIndex++);
      const event: DefecationEvent = { timeSec: this.t, mass: dumped, x, y };
      events.push(event);
      if (this.spotsEnabled) this.spotsInternal.push(event);
    }

    return events;
  }
}
