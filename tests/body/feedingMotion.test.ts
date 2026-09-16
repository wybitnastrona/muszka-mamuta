import { describe, expect, it } from 'vitest';
import {
  CLIP_FPS,
  CLIPS,
  CROSSFADE_S,
  EXTEND_HAUSTELLUM,
  EXTEND_LABELLUM,
  EXTEND_ROSTRUM,
  PER_ANTICIPATION_S,
  MotionMixer,
  blendPoses,
  reviewTime,
  sampleClip,
} from '../../src/body/feedingMotion.ts';
import { eulerDegToQuat, headingError, turnToward } from '../../src/body/math.ts';
import { parseDebugMode } from '../../src/body/debugQuery.ts';
import { CAMERA_PRESETS } from '../../src/body/cameras.ts';

function quatDot(a: readonly number[], b: readonly number[]): number {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
}

describe('feeding motion clips', () => {
  it('authors clips at 24 fps with 120 ms crossfade', () => {
    expect(CLIP_FPS).toBe(24);
    expect(CROSSFADE_S).toBeCloseTo(0.12);
    expect(PER_ANTICIPATION_S).toBeCloseTo(0.03);
  });

  it('extends the proboscis to the authored PER angles', () => {
    const pose = sampleClip(CLIPS.per, CLIPS.per.duration, { reduceMotion: true });
    expect(quatDot(pose.rostrum.rotation, eulerDegToQuat([EXTEND_ROSTRUM, 0, 0]))).toBeGreaterThan(0.98);
    expect(quatDot(pose.haustellum.rotation, eulerDegToQuat([EXTEND_HAUSTELLUM, 0, 0]))).toBeGreaterThan(0.98);
    expect(quatDot(pose.labellum_L.rotation, eulerDegToQuat([0, 0, EXTEND_LABELLUM]))).toBeGreaterThan(0.98);
    expect(quatDot(pose.labellum_R.rotation, eulerDegToQuat([0, 0, -EXTEND_LABELLUM]))).toBeGreaterThan(0.98);
  });

  it('places tarsal taps 250 ms apart', () => {
    const times = CLIPS.tarsalTaste.tracks.foreleg_L_tarsus?.times ?? [];
    const peak = [0.08, 0.33];
    for (const t of peak) expect(times).toContain(t);
    expect(0.33 - 0.08).toBeCloseTo(0.25);
  });

  it('retracts with a 5% overshoot past rest', () => {
    const pose = sampleClip(CLIPS.retract, 0.28, { reduceMotion: true });
    const overshoot = eulerDegToQuat([35 * 0.05, 0, 0]);
    expect(quatDot(pose.rostrum.rotation, overshoot)).toBeGreaterThan(0.98);
  });

  it('crossfades two poses over 120 ms', () => {
    const a = sampleClip(CLIPS.idle, 0, { reduceMotion: true });
    const b = sampleClip(CLIPS.per, CLIPS.per.duration, { reduceMotion: true });
    const mid = blendPoses(a, b, 0.5);
    const da = quatDot(mid.rostrum.rotation, a.rostrum.rotation);
    const db = quatDot(mid.rostrum.rotation, b.rostrum.rotation);
    expect(da).toBeLessThan(0.99);
    expect(db).toBeLessThan(0.99);
    const mixer = new MotionMixer();
    mixer.play('per', { fade: CROSSFADE_S, restart: true });
    mixer.update(CROSSFADE_S);
    expect(mixer.clip.name).toBe('per');
  });

  it('exposes mid-clip review times for EXTEND and PUMP', () => {
    expect(reviewTime('per')).toBeGreaterThan(PER_ANTICIPATION_S);
    expect(reviewTime('per')).toBeLessThan(CLIPS.per.duration);
    expect(reviewTime('pump')).toBeGreaterThan(0);
  });
});

describe('debug query and cameras', () => {
  it('parses ?debug=weights and ?debug=motion', () => {
    expect(parseDebugMode('debug=weights')).toBe('weights');
    expect(parseDebugMode('?debug=motion')).toBe('motion');
    expect(parseDebugMode('debug=extend')).toBe('extend');
    expect(parseDebugMode('debug=pump')).toBe('pump');
    expect(parseDebugMode('')).toBe('off');
  });

  it('names camera presets exactly', () => {
    expect(CAMERA_PRESETS).toEqual(['Widok kuchni', 'Z boku', 'Zbliżenie']);
  });
});

describe('heading helper', () => {
  it('turns the short way toward the target', () => {
    const next = turnToward(Math.PI - 0.1, 0, 0.05, 2.4);
    expect(Math.abs(headingError(next, 0))).toBeLessThan(Math.abs(headingError(Math.PI - 0.1, 0)));
  });
});
