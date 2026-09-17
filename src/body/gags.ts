/**
 * Authored comedy beats. They may read satiety / cropVolume but never write
 * metabolism, ActivityFrame, or the brain worker. Captions are Polish HUD
 * copy; English lives in i18n.
 *
 * Weights [n] are used by `pickGag`. `none` has weight 2.
 */
import type { BoneName, EulerDeg } from './types.ts';
import { Xoshiro128ss } from '../brain/rng.ts';
import { clamp01, lerp } from './math.ts';
import { FLY_WALK_MM_S } from '../scene/scale.ts';
import {
  SONG_ENVELOPE_HZ,
  WING_FLICKER_DEG,
} from './wings.ts';
import {
  PACK_BACK_NUTRITION_ROWS,
  PACK_FRONT_COW_UV,
  PACK_FRONT_LANDING_UV,
  pouchCreaseDir,
  pouchWorldFromUv,
} from '../scene/labelLandmarks.ts';
import { GROOM_SHORT_S, groomShortOverlay, napOverlay } from './grooming.ts';
import { TAKEOFF_HOP_MM, TAKEOFF_RAISE_S } from './flight.ts';

export const GAG_IDS = [
  'courtshipSong',
  'foilSlip',
  'crumbOnLeg',
  'tooFull',
  'escapeShadow',
  'readsLabel',
] as const;

export type GagId = (typeof GAG_IDS)[number];

export const GAG_WEIGHTS: Record<GagId | 'none', number> = {
  courtshipSong: 3,
  foilSlip: 2,
  crumbOnLeg: 2,
  tooFull: 2,
  escapeShadow: 1,
  readsLabel: 1,
  none: 2,
};

export const GAG_CAPTIONS_PL: Record<GagId, string> = {
  courtshipSong: 'Śpiewa do krowy',
  foilSlip: 'Śliska folia',
  crumbOnLeg: 'Okruszek',
  tooFull: 'Za dużo zjadła',
  escapeShadow: 'Cień łyżki',
  readsLabel: 'Czyta skład',
};

export const GAG_DURATION_CAP: Record<GagId, number> = {
  courtshipSong: 9,
  foilSlip: 6,
  crumbOnLeg: 5.5,
  tooFull: 18,
  escapeShadow: 1.5,
  readsLabel: 7,
};

export type GagContext = {
  satiety: number;
  cropVolume: number;
  position: { x: number; y: number; z: number };
  heading: number;
  pouch: { x: number; y: number; z: number; yaw: number };
  food: { x: number; y: number; z: number };
  standingY: number;
};

export type CrumbBone = 'foreleg_L_tarsus' | 'foreleg_R_tarsus' | null;

export type GagFrame = {
  done: boolean;
  caption: string;
  euler: Partial<Record<BoneName, EulerDeg>>;
  position: { x: number; y: number; z: number };
  heading: number;
  wingRaiseL: number;
  wingRaiseR: number;
  wingSongL: number;
  wingSongR: number;
  wingBlurL: number;
  wingBlurR: number;
  wingFlicker: number;
  spoonShadow: number;
  crumbAttach: CrumbBone;
  sinkMm: number;
  nap: boolean;
  napDoubled: boolean;
  takeoffAttempt: boolean;
  escape: boolean;
  mode: 'ground' | 'flight' | 'onFood';
};

export type GagEligibility = {
  satiety: number;
  cropVolume: number;
};

export function gagEligible(id: GagId, ctx: GagEligibility): boolean {
  if (id === 'courtshipSong') return ctx.satiety > 0.5;
  if (id === 'tooFull') return ctx.cropVolume > 0.85;
  return true;
}

export function pickGag(rng: Xoshiro128ss, ctx: GagEligibility): GagId | null {
  const entries: { id: GagId | 'none'; w: number }[] = [
    ...GAG_IDS.map((id) => ({ id, w: gagEligible(id, ctx) ? GAG_WEIGHTS[id] : 0 })),
    { id: 'none', w: GAG_WEIGHTS.none },
  ];
  const total = entries.reduce((s, e) => s + e.w, 0);
  if (total <= 0) return null;
  let r = rng.nextFloat() * total;
  for (const e of entries) {
    r -= e.w;
    if (r < 0) return e.id === 'none' ? null : e.id;
  }
  return null;
}

function walkToward(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  dt: number,
  speed = FLY_WALK_MM_S,
): { x: number; y: number; z: number; heading: number; arrived: boolean } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const heading = Math.atan2(dx, dz);
  if (dist < 0.8) return { x: to.x, y: from.y, z: to.z, heading, arrived: true };
  const step = Math.min(dist, speed * dt);
  return {
    x: from.x + (dx / dist) * step,
    y: from.y,
    z: from.z + (dz / dist) * step,
    heading,
    arrived: dist <= step + 0.05,
  };
}

const EMPTY: GagFrame = {
  done: true,
  caption: '',
  euler: {},
  position: { x: 0, y: 0, z: 0 },
  heading: 0,
  wingRaiseL: 0,
  wingRaiseR: 0,
  wingSongL: 0,
  wingSongR: 0,
  wingBlurL: 0,
  wingBlurR: 0,
  wingFlicker: 0,
  spoonShadow: 0,
  crumbAttach: null,
  sinkMm: 0,
  nap: false,
  napDoubled: false,
  takeoffAttempt: false,
  escape: false,
  mode: 'ground',
};

export class GagPlayer {
  id: GagId | null = null;
  time = 0;
  private phase = 0;
  private phaseT = 0;
  private pos = { x: 0, y: 0, z: 0 };
  private heading = 0;
  private crumb: CrumbBone = 'foreleg_L_tarsus';
  private hops = 0;
  private startY = 0;

  start(id: GagId | null, ctx: GagContext): void {
    this.id = id;
    this.time = 0;
    this.phase = 0;
    this.phaseT = 0;
    this.pos = { ...ctx.position };
    this.heading = ctx.heading;
    this.crumb = 'foreleg_L_tarsus';
    this.hops = 0;
    this.startY = ctx.position.y;
  }

  get active(): boolean {
    return this.id !== null;
  }

  update(dt: number, ctx: GagContext): GagFrame {
    if (!this.id) return { ...EMPTY, position: { ...this.pos }, heading: this.heading, done: true };
    this.time += dt;
    this.phaseT += dt;
    const cap = GAG_DURATION_CAP[this.id];
    let frame: GagFrame;
    switch (this.id) {
      case 'courtshipSong': frame = this.courtship(dt, ctx); break;
      case 'foilSlip': frame = this.foil(dt, ctx); break;
      case 'crumbOnLeg': frame = this.crumbOnLeg(dt); break;
      case 'tooFull': frame = this.tooFull(dt, ctx); break;
      case 'escapeShadow': frame = this.escape(dt, ctx); break;
      case 'readsLabel': frame = this.reads(dt, ctx); break;
    }
    if (this.time >= cap) frame = { ...frame, done: true };
    return frame;
  }

  private base(over: Partial<GagFrame>): GagFrame {
    return {
      ...EMPTY,
      done: false,
      caption: this.id ? GAG_CAPTIONS_PL[this.id] : '',
      position: { ...this.pos },
      heading: this.heading,
      mode: 'ground',
      ...over,
    };
  }

  private courtship(dt: number, ctx: GagContext): GagFrame {
    const land = pouchWorldFromUv(PACK_FRONT_LANDING_UV, ctx.pouch);
    const cow = pouchWorldFromUv(PACK_FRONT_COW_UV, ctx.pouch);
    land.y = ctx.standingY + 2;
    cow.y = ctx.standingY + 2;
    if (this.phase === 0) {
      const w = walkToward(this.pos, land, dt);
      this.pos = { x: w.x, y: land.y, z: w.z };
      this.heading = w.heading;
      if (w.arrived) this.phase = 1;
      return this.base({});
    }
    if (this.phase === 1) {
      const w = walkToward(this.pos, cow, dt);
      this.pos = { x: w.x, y: cow.y, z: w.z };
      this.heading = w.heading;
      if (w.arrived) {
        this.heading = Math.atan2(cow.x - this.pos.x, cow.z - this.pos.z);
        this.phase = 2;
        this.phaseT = 0;
      }
      return this.base({});
    }
    const t = this.phaseT;
    const env = Math.sin(2 * Math.PI * SONG_ENVELOPE_HZ * t);
    const vib = 14 * env;
    const blur = 0.42 + 0.58 * (0.5 + 0.5 * env);
    if (t < 2.5) {
      return this.base({
        wingRaiseL: 1,
        wingSongL: 90 + vib,
        wingSongR: 0,
        wingBlurL: blur,
        wingBlurR: 0,
        wingFlicker: WING_FLICKER_DEG * (0.55 + 0.45 * env),
      });
    }
    if (t < 3.3) return this.base({ wingRaiseL: 0, wingRaiseR: 0 });
    if (t < 4.8) {
      return this.base({
        wingRaiseR: 1,
        wingSongR: 90 + vib,
        wingBlurL: 0,
        wingBlurR: blur,
        wingFlicker: WING_FLICKER_DEG * (0.55 + 0.45 * env),
      });
    }
    if (t < 5.4) return this.base({});
    const off = { x: land.x - 18, y: land.y, z: land.z - 10 };
    const w = walkToward(this.pos, off, dt);
    this.pos = { x: w.x, y: off.y, z: w.z };
    this.heading = w.heading;
    return this.base({ done: w.arrived || t >= 8 });
  }

  private foil(dt: number, ctx: GagContext): GagFrame {
    const land = pouchWorldFromUv(PACK_FRONT_LANDING_UV, ctx.pouch);
    land.y = ctx.standingY + 2;
    const dir = pouchCreaseDir(ctx.pouch.yaw);
    if (this.phase === 0) {
      const w = walkToward(this.pos, land, dt);
      this.pos = { x: w.x, y: land.y, z: w.z };
      this.heading = w.heading;
      if (w.arrived) {
        this.phase = 1;
        this.phaseT = 0;
      }
      return this.base({});
    }
    const t = this.phaseT;
    if (t < 0.25) {
      const u = t / 0.25;
      this.pos.x = land.x + dir.x * 12 * u;
      this.pos.z = land.z + dir.z * 12 * u;
      return this.base({
        euler: {
          foreleg_L_tarsus: [25, 0, 40],
          foreleg_R_tarsus: [25, 0, -40],
        },
      });
    }
    if (t < 0.45) {
      return this.base({
        euler: { root: [180 * ((t - 0.25) / 0.2), 0, 0] },
      });
    }
    if (t < 0.95) {
      const wave = Math.sin((t - 0.45) * 40) * 35;
      return this.base({
        euler: {
          root: [180, 0, 0],
          foreleg_L_tarsus: [wave, 0, 20],
          foreleg_R_tarsus: [-wave, 0, -20],
        },
      });
    }
    if (t < 1.2) {
      return this.base({ euler: { root: [180 * (1 - (t - 0.95) / 0.25), 0, 0] } });
    }
    const g = groomShortOverlay(t - 1.2, 1.35);
    return this.base({ euler: g.euler, done: g.done });
  }

  private crumbOnLeg(dt: number): GagFrame {
    const cycle = 0.7;
    const n = Math.floor(this.time / cycle);
    if (n >= 6) {
      return this.base({ crumbAttach: null, done: true });
    }
    const rub = (this.time % cycle) > 0.35;
    this.crumb = n % 2 === 0 ? 'foreleg_L_tarsus' : 'foreleg_R_tarsus';
    const g = rub ? groomShortOverlay(0.6 + (this.time % 0.3), 1) : { euler: {} };
    void dt;
    return this.base({
      crumbAttach: this.crumb,
      euler: g.euler,
      done: false,
    });
  }

  private tooFull(dt: number, ctx: GagContext): GagFrame {
    const t = this.time;
    if (t < TAKEOFF_RAISE_S) {
      return this.base({
        takeoffAttempt: true,
        wingRaiseL: t / TAKEOFF_RAISE_S,
        wingRaiseR: t / TAKEOFF_RAISE_S,
        mode: 'ground',
      });
    }
    const hopT = t - TAKEOFF_RAISE_S;
    if (hopT < 0.28) {
      const u = hopT / 0.28;
      const hop = 5 * Math.sin(Math.PI * Math.min(1, u));
      this.pos.y = this.startY + hop;
      const folding = u > 0.55;
      return this.base({
        takeoffAttempt: true,
        wingRaiseL: folding ? 1 - (u - 0.55) / 0.45 : 1,
        wingRaiseR: folding ? 1 - (u - 0.55) / 0.45 : 1,
        mode: 'flight',
      });
    }
    this.pos.y = this.startY;
    if (hopT < 0.7) {
      return this.base({
        euler: groomShortOverlay(0.2, 1).euler,
        wingRaiseL: 0,
        wingRaiseR: 0,
      });
    }
    const nap = napOverlay(hopT - 0.7, ctx.satiety, true);
    this.pos.y = this.startY - nap.sinkMm;
    return this.base({
      nap: true,
      napDoubled: true,
      caption: GAG_CAPTIONS_PL.tooFull,
      euler: nap.euler,
      sinkMm: nap.sinkMm,
      done: nap.done,
    });
  }

  private escape(_dt: number, ctx: GagContext): GagFrame {
    const t = this.time;
    const shadow = t < 0.4 ? 1 : Math.max(0, 1 - (t - 0.4) / 0.15);
    return this.base({
      spoonShadow: shadow,
      escape: true,
      mode: 'flight',
      caption: GAG_CAPTIONS_PL.escapeShadow,
      position: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
      done: t >= 1.45,
      heading: Math.atan2(ctx.food.x - this.pos.x, ctx.food.z - this.pos.z),
    });
  }

  private reads(dt: number, ctx: GagContext): GagFrame {
    const rows = PACK_BACK_NUTRITION_ROWS.map((r) => {
      const p = pouchWorldFromUv(r.uv, ctx.pouch);
      p.y = ctx.standingY + 2;
      return p;
    });
    const protein = rows[rows.length - 1]!;
    if (this.phase < rows.length) {
      const w = walkToward(this.pos, rows[this.phase]!, dt, FLY_WALK_MM_S * 0.85);
      this.pos = { x: w.x, y: rows[this.phase]!.y, z: w.z };
      this.heading = w.heading;
      if (w.arrived) this.phase += 1;
      return this.base({});
    }
    if (this.phase === rows.length) {
      this.phase = rows.length + 1;
      this.phaseT = 0;
    }
    if (this.phaseT < 1.1) {
      const k = Math.floor(this.phaseT / 0.35);
      return this.base({
        position: protein,
        euler: { antenna_L: [0, (k % 2 === 0 ? 18 : -6), 0], antenna_R: [0, (k % 2 === 0 ? -6 : 18), 0] },
      });
    }
    const food = { x: ctx.food.x, y: ctx.standingY + 16, z: ctx.food.z };
    const w = walkToward(this.pos, food, dt, FLY_WALK_MM_S * 4);
    this.pos = { x: w.x, y: lerp(this.pos.y, food.y, 0.2), z: w.z };
    this.heading = w.heading;
    return this.base({ mode: 'flight', wingRaiseL: 1, wingRaiseR: 1, done: w.arrived || this.time > 6 });
  }
}

export { GROOM_SHORT_S };
