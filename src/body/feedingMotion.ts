import type { BoneName, BonePose, ClipName, EulerDeg, Pose, Quat } from './types.ts';
import { BONE_NAMES, CLIP_NAMES } from './types.ts';
import {
  IDENTITY,
  clamp,
  clamp01,
  easeInOut,
  eulerDegToQuat,
  perlin1,
  slerp,
} from './math.ts';

export const CLIP_FPS = 24;
export const CROSSFADE_S = 0.12;
export const PER_ANTICIPATION_S = 0.03;
export const PUMP_HZ = 6;
export const ANTENNA_SWEEP_DEG = 8;
export const ANTENNA_SWEEP_HZ = 3;

/**
 * PER rotation is about the left–right axis (X). Frame: +X left, +Y dorsal,
 * +Z anterior. Negative X pitches the hanging tip anterior and ventral
 * (+Z, −Y) with dX = 0. Positive X folds it up/back. Y or Z would splay
 * the tip sideways. Verified against the labellum offset; axis unchanged.
 */
const EXTEND_ROSTRUM = -35;
const EXTEND_HAUSTELLUM = -60;
const EXTEND_LABELLUM = 18;

export type SampleOpts = {
  amplitude?: number;
  timeSec?: number;
  jitterSeed?: number;
  reduceMotion?: boolean;
};

export type Clip = {
  name: ClipName;
  duration: number;
  loop: boolean;
  ease: 'linear' | 'inOut';
  tracks: Partial<Record<BoneName, { times: number[]; values: number[] }>>;
};

type EulerKey = { t: number; bones: Partial<Record<BoneName, EulerDeg>> };

function restPose(): Pose {
  const pose = {} as Pose;
  for (const name of BONE_NAMES) pose[name] = { rotation: IDENTITY };
  return pose;
}

function trackFromKeys(keys: { t: number; euler: EulerDeg }[]): { times: number[]; values: number[] } {
  const times: number[] = [];
  const values: number[] = [];
  for (const key of keys) {
    times.push(key.t);
    const q = eulerDegToQuat(key.euler);
    values.push(q[0], q[1], q[2], q[3]);
  }
  return { times, values };
}

function clipFromEulerKeys(
  name: ClipName,
  duration: number,
  loop: boolean,
  ease: 'linear' | 'inOut',
  keys: EulerKey[],
): Clip {
  const bones = new Set<BoneName>();
  for (const key of keys) for (const name of Object.keys(key.bones) as BoneName[]) bones.add(name);
  const tracks: Clip['tracks'] = {};
  for (const bone of bones) {
    const series: { t: number; euler: EulerDeg }[] = [];
    let last: EulerDeg = [0, 0, 0];
    for (const key of keys) {
      const e = key.bones[bone];
      if (e) last = e;
      series.push({ t: key.t, euler: last });
    }
    if (series[0].t > 0) series.unshift({ t: 0, euler: series[0].euler });
    if (series[series.length - 1].t < duration) series.push({ t: duration, euler: series[series.length - 1].euler });
    tracks[bone] = trackFromKeys(series);
  }
  return { name, duration, loop, ease, tracks };
}

function bake(
  name: ClipName,
  duration: number,
  loop: boolean,
  fn: (t: number) => Partial<Record<BoneName, EulerDeg>>,
): Clip {
  const n = Math.round(duration * CLIP_FPS);
  const keys: EulerKey[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * duration;
    keys.push({ t, bones: fn(t) });
  }
  return clipFromEulerKeys(name, duration, loop, 'linear', keys);
}

const EXTENDED: Partial<Record<BoneName, EulerDeg>> = {
  rostrum: [EXTEND_ROSTRUM, 0, 0],
  haustellum: [EXTEND_HAUSTELLUM, 0, 0],
  labellum_L: [0, 0, EXTEND_LABELLUM],
  labellum_R: [0, 0, -EXTEND_LABELLUM],
};

function extendedPose(): Pose {
  const pose = restPose();
  for (const [name, euler] of Object.entries(EXTENDED) as [BoneName, EulerDeg][]) {
    pose[name] = { rotation: eulerDegToQuat(euler) };
  }
  return pose;
}

const EXTENDED_POSE = extendedPose();

export const CLIPS: Record<ClipName, Clip> = {
  odorTrack: bake('odorTrack', 1, true, (t) => {
    const a = ANTENNA_SWEEP_DEG * Math.sin(2 * Math.PI * ANTENNA_SWEEP_HZ * t);
    return {
      antenna_L: [0, a, 0],
      antenna_R: [0, -a, 0],
    };
  }),

  approach: bake('approach', 0.75, false, (t) => {
    const steps = 3;
    const phase = (t / 0.75) * steps;
    const step = phase % 1;
    const lift = Math.sin(step * Math.PI) * 22;
    const left = Math.floor(phase) % 2 === 0;
    const bob = Math.sin(phase * Math.PI) * 2;
    return {
      root: [bob * 0.4, 0, 0],
      abdomen: [bob, 0, 0],
      foreleg_L_tarsus: [left ? -lift : lift * 0.15, 0, left ? 6 : 0],
      foreleg_R_tarsus: [left ? lift * 0.15 : -lift, 0, left ? 0 : -6],
    };
  }),

  tarsalTaste: clipFromEulerKeys('tarsalTaste', 0.5, false, 'inOut', [
    { t: 0, bones: { foreleg_L_tarsus: [0, 0, 0], foreleg_R_tarsus: [0, 0, 0] } },
    { t: 0.08, bones: { foreleg_L_tarsus: [10, 0, 4], foreleg_R_tarsus: [8, 0, -3] } },
    { t: 0.16, bones: { foreleg_L_tarsus: [0, 0, 0], foreleg_R_tarsus: [0, 0, 0] } },
    { t: 0.33, bones: { foreleg_L_tarsus: [10, 0, 4], foreleg_R_tarsus: [8, 0, -3] } },
    { t: 0.41, bones: { foreleg_L_tarsus: [0, 0, 0], foreleg_R_tarsus: [0, 0, 0] } },
    { t: 0.5, bones: { foreleg_L_tarsus: [0, 0, 0], foreleg_R_tarsus: [0, 0, 0] } },
  ]),

  per: clipFromEulerKeys('per', 0.4, false, 'inOut', [
    { t: 0, bones: { rostrum: [0, 0, 0], haustellum: [0, 0, 0], labellum_L: [0, 0, 0], labellum_R: [0, 0, 0] } },
    {
      t: PER_ANTICIPATION_S,
      bones: { rostrum: [2, 0, 0], haustellum: [3, 0, 0], labellum_L: [0, 0, -1], labellum_R: [0, 0, 1] },
    },
    {
      t: 0.4,
      bones: {
        rostrum: [EXTEND_ROSTRUM, 0, 0],
        haustellum: [EXTEND_HAUSTELLUM, 0, 0],
        labellum_L: [0, 0, EXTEND_LABELLUM],
        labellum_R: [0, 0, -EXTEND_LABELLUM],
      },
    },
  ]),

  pump: bake('pump', 1 / PUMP_HZ, true, (t) => {
    const wave = Math.sin(2 * Math.PI * PUMP_HZ * t);
    return {
      rostrum: [EXTEND_ROSTRUM + wave * -4, 0, 0],
      haustellum: [EXTEND_HAUSTELLUM + wave * -8, 0, 0],
      labellum_L: [0, 0, EXTEND_LABELLUM + wave * 4],
      labellum_R: [0, 0, -EXTEND_LABELLUM - wave * 4],
    };
  }),

  retract: clipFromEulerKeys('retract', 0.42, false, 'inOut', [
    {
      t: 0,
      bones: {
        rostrum: [EXTEND_ROSTRUM, 0, 0],
        haustellum: [EXTEND_HAUSTELLUM, 0, 0],
        labellum_L: [0, 0, EXTEND_LABELLUM],
        labellum_R: [0, 0, -EXTEND_LABELLUM],
      },
    },
    {
      t: 0.28,
      bones: {
        rostrum: [35 * 0.05, 0, 0],
        haustellum: [60 * 0.05, 0, 0],
        labellum_L: [0, 0, -18 * 0.05],
        labellum_R: [0, 0, 18 * 0.05],
      },
    },
    {
      t: 0.42,
      bones: { rostrum: [0, 0, 0], haustellum: [0, 0, 0], labellum_L: [0, 0, 0], labellum_R: [0, 0, 0] },
    },
  ]),

  groom: clipFromEulerKeys('groom', 0.7, false, 'inOut', [
    { t: 0, bones: { head: [0, 0, 0], foreleg_L_tarsus: [0, 0, 0], foreleg_R_tarsus: [0, 0, 0] } },
    {
      t: 0.22,
      bones: {
        head: [16, 8, 0],
        antenna_L: [0, 6, 0],
        antenna_R: [0, -6, 0],
        foreleg_L_tarsus: [-48, 12, 28],
        foreleg_R_tarsus: [-48, -12, -28],
      },
    },
    {
      t: 0.48,
      bones: {
        head: [10, -8, 0],
        antenna_L: [0, -4, 0],
        antenna_R: [0, 4, 0],
        foreleg_L_tarsus: [-40, -10, 22],
        foreleg_R_tarsus: [-40, 10, -22],
      },
    },
    { t: 0.7, bones: { head: [0, 0, 0], foreleg_L_tarsus: [0, 0, 0], foreleg_R_tarsus: [0, 0, 0] } },
  ]),

  idle: bake('idle', 1, true, (t) => {
    const breath = Math.sin(2 * Math.PI * t) * 2;
    const ant = Math.sin(2 * Math.PI * t * 0.7) * 1.2;
    return {
      abdomen: [breath, 0, 0],
      antenna_L: [0, ant, 0],
      antenna_R: [0, -ant * 0.85, 0],
      root: [breath * 0.15, 0, 0],
    };
  }),
};

export const CLIP_DURATION: Record<ClipName, number> = {
  odorTrack: CLIPS.odorTrack.duration,
  approach: CLIPS.approach.duration,
  tarsalTaste: CLIPS.tarsalTaste.duration,
  per: CLIPS.per.duration,
  pump: CLIPS.pump.duration,
  retract: CLIPS.retract.duration,
  groom: CLIPS.groom.duration,
  idle: CLIPS.idle.duration,
};

function quatAt(track: { times: number[]; values: number[] }, t: number, ease: Clip['ease']): Quat {
  const times = track.times;
  const values = track.values;
  if (times.length === 0) return IDENTITY;
  if (t <= times[0]) return [values[0], values[1], values[2], values[3]];
  const last = times.length - 1;
  if (t >= times[last]) {
    const o = last * 4;
    return [values[o], values[o + 1], values[o + 2], values[o + 3]];
  }
  let i = 1;
  while (i < times.length && times[i] < t) i++;
  const t0 = times[i - 1];
  const t1 = times[i];
  const uRaw = (t - t0) / Math.max(1e-9, t1 - t0);
  const u = ease === 'inOut' ? easeInOut(uRaw) : uRaw;
  const a: Quat = [values[(i - 1) * 4], values[(i - 1) * 4 + 1], values[(i - 1) * 4 + 2], values[(i - 1) * 4 + 3]];
  const b: Quat = [values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]];
  return slerp(a, b, u);
}

export function sampleClip(clip: Clip, timeSec: number, opts: SampleOpts = {}): Pose {
  const duration = clip.duration;
  let t = timeSec;
  if (clip.loop && duration > 0) {
    t = ((t % duration) + duration) % duration;
  } else {
    t = clamp(t, 0, duration);
  }
  const pose = restPose();
  for (const name of BONE_NAMES) {
    const track = clip.tracks[name];
    pose[name] = { rotation: track ? quatAt(track, t, clip.ease) : IDENTITY };
  }
  if (clip.name === 'pump') {
    const amp = clamp01(opts.amplitude ?? 1);
    for (const name of BONE_NAMES) {
      pose[name] = { rotation: slerp(EXTENDED_POSE[name].rotation, pose[name].rotation, amp) };
    }
  }
  return applySecondary(pose, clip.name, opts);
}

function addEuler(q: Quat, euler: EulerDeg): Quat {
  if (euler[0] === 0 && euler[1] === 0 && euler[2] === 0) return q;
  return mulApprox(q, eulerDegToQuat(euler));
}

function mulApprox(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function applySecondary(pose: Pose, clipName: ClipName, opts: SampleOpts): Pose {
  if (opts.reduceMotion) return pose;
  const t = opts.timeSec ?? 0;
  const seed = opts.jitterSeed ?? 1;
  const j = 3 + perlin1(t * 1.7, seed) ; // 2–4 deg
  const jL = j * perlin1(t * 5.3, seed + 2);
  const jR = j * perlin1(t * 5.3 + 8, seed + 3);
  const out = {} as Pose;
  for (const name of BONE_NAMES) out[name] = pose[name];
  out.antenna_L = { rotation: addEuler(pose.antenna_L.rotation, [jL * 0.35, jL, 0]) };
  out.antenna_R = { rotation: addEuler(pose.antenna_R.rotation, [jR * 0.35, -jR, 0]) };
  if (clipName === 'pump') {
    const foot = 1.2 * perlin1(t * 11, seed + 9);
    out.foreleg_L_tarsus = { rotation: addEuler(pose.foreleg_L_tarsus.rotation, [foot, 0, foot * 0.4]) };
    out.foreleg_R_tarsus = { rotation: addEuler(pose.foreleg_R_tarsus.rotation, [-foot * 0.8, 0, -foot * 0.3]) };
  }
  return out;
}

export function overlayEuler(pose: Pose, overlay: Partial<Record<BoneName, EulerDeg>>): Pose {
  const out = {} as Pose;
  for (const name of BONE_NAMES) {
    const extra = overlay[name];
    out[name] = extra
      ? { rotation: mulApprox(pose[name].rotation, eulerDegToQuat(extra)) }
      : pose[name];
  }
  return out;
}

export function blendPoses(a: Pose, b: Pose, alpha: number): Pose {
  const t = clamp01(alpha);
  const u = easeInOut(t);
  const out = {} as Pose;
  for (const name of BONE_NAMES) {
    out[name] = { rotation: slerp(a[name].rotation, b[name].rotation, u) };
  }
  return out;
}

export function reviewTime(name: ClipName): number {
  if (name === 'per') return PER_ANTICIPATION_S + (CLIPS.per.duration - PER_ANTICIPATION_S) * 0.5;
  if (name === 'pump') return (0.5 / PUMP_HZ);
  return CLIPS[name].duration * 0.5;
}

export function clipForState(
  state: 'SEARCH' | 'ORIENT' | 'APPROACH' | 'TASTE' | 'EXTEND' | 'PUMP' | 'RETRACT' | 'REST',
  satiety: number,
): ClipName {
  switch (state) {
    case 'SEARCH':
    case 'ORIENT':
      return 'odorTrack';
    case 'APPROACH':
      return 'approach';
    case 'TASTE':
      return 'tarsalTaste';
    case 'EXTEND':
      return 'per';
    case 'PUMP':
      return 'pump';
    case 'RETRACT':
      return 'retract';
    case 'REST':
      return satiety > 0.7 ? 'groom' : 'idle';
  }
}

export class MotionMixer {
  clip: Clip = CLIPS.idle;
  time = 0;
  ended = false;
  private from: Clip | null = null;
  private fromTime = 0;
  private fade = CROSSFADE_S;
  private worldTime = 0;
  private amplitude = 1;
  private jitterSeed = 1;
  private reduceMotion = false;

  play(name: ClipName, opts: { amplitude?: number; fade?: number; restart?: boolean } = {}): void {
    if (this.clip.name === name && !opts.restart) {
      if (opts.amplitude !== undefined) this.amplitude = opts.amplitude;
      return;
    }
    this.from = this.clip;
    this.fromTime = this.time;
    this.fade = 0;
    this.clip = CLIPS[name];
    this.time = 0;
    this.ended = false;
    if (opts.amplitude !== undefined) this.amplitude = opts.amplitude;
    this.fadeDuration = opts.fade ?? CROSSFADE_S;
  }

  private fadeDuration = CROSSFADE_S;

  setAmplitude(value: number): void {
    this.amplitude = clamp01(value);
  }

  setJitter(seed: number, reduceMotion: boolean): void {
    this.jitterSeed = seed;
    this.reduceMotion = reduceMotion;
  }

  update(dt: number): Pose {
    const dtClamped = Math.max(0, dt);
    this.worldTime += dtClamped;
    this.time += dtClamped;
    this.fromTime += dtClamped;
    if (this.clip.loop) {
      if (this.clip.duration > 0) this.time %= this.clip.duration;
      this.ended = false;
    } else if (this.time >= this.clip.duration) {
      this.time = this.clip.duration;
      this.ended = true;
    }
    this.fade = Math.min(this.fadeDuration, this.fade + dtClamped);
    const opts: SampleOpts = {
      amplitude: this.amplitude,
      timeSec: this.worldTime,
      jitterSeed: this.jitterSeed,
      reduceMotion: this.reduceMotion,
    };
    const current = sampleClip(this.clip, this.time, opts);
    if (!this.from || this.fade >= this.fadeDuration) {
      this.from = null;
      return current;
    }
    const prev = sampleClip(this.from, this.fromTime, opts);
    return blendPoses(prev, current, this.fadeDuration <= 0 ? 1 : this.fade / this.fadeDuration);
  }
}

export const MOTION_LOOP_ORDER: ClipName[] = [...CLIP_NAMES];

export function eulerOf(pose: BonePose): { x: number; y: number; z: number; w: number } {
  return { x: pose.rotation[0], y: pose.rotation[1], z: pose.rotation[2], w: pose.rotation[3] };
}

export { EXTENDED_POSE, EXTEND_ROSTRUM, EXTEND_HAUSTELLUM, EXTEND_LABELLUM };
