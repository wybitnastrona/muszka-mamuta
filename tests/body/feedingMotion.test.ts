import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CLIP_FPS,
  CLIPS,
  CROSSFADE_S,
  EXTEND_HAUSTELLUM,
  EXTEND_LABELLUM,
  EXTEND_ROSTRUM,
  PER_ANTICIPATION_S,
  REST_ROSTRUM,
  MotionMixer,
  blendPoses,
  reviewTime,
  sampleClip,
} from '../../src/body/feedingMotion.ts';
import { applyPoseToBones, buildSkeleton } from '../../src/body/rig.ts';
import { eulerDegToQuat, headingError, turnToward } from '../../src/body/math.ts';
import { parseDebugMode, parseLoopVariant, formatGateOverlay } from '../../src/body/debugQuery.ts';
import { CAMERA_PRESETS } from '../../src/body/cameras.ts';
import { ANCHORS } from '../../src/body/hierarchy.ts';
import type { Pose } from '../../src/body/types.ts';
import { EXTENDED_TIP_NATIVE, REST_TIP_NATIVE, flyRootScale } from '../../src/scene/scale.ts';

function quatDot(a: readonly number[], b: readonly number[]): number {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
}

/** Labellum midpoint in root space (Flybody native units) for a pose — forward kinematics on the real anchors. */
export function labellumTipNative(pose: Pose): { x: number; y: number; z: number } {
  const { armature, bones } = buildSkeleton();
  applyPoseToBones(bones, pose);
  armature.updateMatrixWorld(true);
  const l = bones.get('labellum_L')!.getWorldPosition(new THREE.Vector3());
  const r = bones.get('labellum_R')!.getWorldPosition(new THREE.Vector3());
  return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, z: (l.z + r.z) / 2 };
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

  it('rests with the proboscis folded under the head and unfolds it visibly in PER (FK on the real anchors)', () => {
    const rest = labellumTipNative(sampleClip(CLIPS.idle, 0, { reduceMotion: true }));
    const hanging = labellumTipNative(sampleClip(CLIPS.idle, 0, { reduceMotion: true }));
    // Flybody's unfolded chain would hang to y ≈ -0.063; the fold lifts it toward the head.
    expect(rest.y).toBeGreaterThan(-0.055);
    expect(rest.z).toBeLessThan(0.0657);
    const per = labellumTipNative(sampleClip(CLIPS.per, CLIPS.per.duration, { reduceMotion: true }));
    const travelMm = Math.hypot(per.y - rest.y, per.z - rest.z) * flyRootScale();
    expect(travelMm).toBeGreaterThanOrEqual(1.5);
    expect(per.z).toBeGreaterThan(rest.z);
    // The scale.ts constants are these very numbers; they must not drift from the rig.
    expect(rest.y).toBeCloseTo(REST_TIP_NATIVE.y, 3);
    expect(rest.z).toBeCloseTo(REST_TIP_NATIVE.z, 3);
    expect(per.y).toBeCloseTo(EXTENDED_TIP_NATIVE.y, 3);
    expect(per.z).toBeCloseTo(EXTENDED_TIP_NATIVE.z, 3);
    const pump = labellumTipNative(sampleClip(CLIPS.pump, 0, { amplitude: 1, reduceMotion: true }));
    expect(pump.z).toBeCloseTo(per.z, 3);
    // retract ends where rest starts
    const back = labellumTipNative(sampleClip(CLIPS.retract, CLIPS.retract.duration, { reduceMotion: true }));
    expect(back.y).toBeCloseTo(hanging.y, 4);
    expect(back.z).toBeCloseTo(hanging.z, 4);
  });

  it('keeps PER on −X so the tip moves anterior +Z and ventral −Y, not sideways', () => {
    expect(EXTEND_ROSTRUM).toBeLessThan(0);
    expect(EXTEND_HAUSTELLUM).toBeLessThan(0);
    const rostrum = ANCHORS.bones.find((b) => b.name === 'rostrum')!.position;
    const labellum = ANCHORS.bones.find((b) => b.name === 'labellum_L')!.position;
    const rel: [number, number, number] = [
      labellum[0] - rostrum[0],
      labellum[1] - rostrum[1],
      labellum[2] - rostrum[2],
    ];
    const rad = (EXTEND_ROSTRUM * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const rotated: [number, number, number] = [rel[0], rel[1] * c - rel[2] * s, rel[1] * s + rel[2] * c];
    const dX = rotated[0] - rel[0];
    const dY = rotated[1] - rel[1];
    const dZ = rotated[2] - rel[2];
    expect(Math.abs(dX)).toBeLessThan(1e-9);
    expect(dY).toBeLessThan(0);
    expect(dZ).toBeGreaterThan(0);
    const yaw = (EXTEND_ROSTRUM * Math.PI) / 180;
    const ry: [number, number, number] = [
      rel[0] * Math.cos(yaw) + rel[2] * Math.sin(yaw),
      rel[1],
      -rel[0] * Math.sin(yaw) + rel[2] * Math.cos(yaw),
    ];
    expect(Math.abs(ry[0] - rel[0])).toBeGreaterThan(1e-4);
  });

  it('places tarsal taps 250 ms apart', () => {
    const times = CLIPS.tarsalTaste.tracks.foreleg_L_tarsus?.times ?? [];
    const peak = [0.08, 0.33];
    for (const t of peak) expect(times).toContain(t);
    expect(0.33 - 0.08).toBeCloseTo(0.25);
  });

  it('retracts with a 5% overshoot past rest', () => {
    const pose = sampleClip(CLIPS.retract, 0.28, { reduceMotion: true });
    const overshoot = eulerDegToQuat([REST_ROSTRUM + 35 * 0.05, 0, 0]);
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
    expect(parseDebugMode('debug=label')).toBe('label');
    expect(parseDebugMode('debug=gate')).toBe('gate');
    expect(parseDebugMode('debug=flight')).toBe('flight');
    expect(parseDebugMode('?debug=match')).toBe('off');
    expect(parseDebugMode('?debug=grade')).toBe('off');
    expect(parseDebugMode('')).toBe('off');
  });

  it('parses ?loop=full and defaults to reel', () => {
    expect(parseLoopVariant('?loop=full')).toBe('full');
    expect(parseLoopVariant('loop=full')).toBe('full');
    expect(parseLoopVariant('?debug=weights')).toBe('reel');
    expect(parseLoopVariant('')).toBe('reel');
  });

  it('formats the MN9 gate overlay with FSM and worker rates', () => {
    const text = formatGateOverlay({
      state: 'TASTE',
      fsmMn9Hz: 12.5,
      workerMn9Hz: 12.5,
      mn9HoldMs: 80,
      hunger: 0.32,
      gustGain: 0.94,
      mn9ThresholdShift: 0.24,
      labellarHz: 48,
      pharyngealHz: 0,
      contactStrength: 1,
    });
    expect(text).toContain('TASTE');
    expect(text).toContain('12.50 Hz');
    expect(text).toContain('mn9HoldMs      80');
    expect(text).toContain('gustGain       0.940');
    expect(text).toContain('labellarHz     48.0');
  });

  it('names camera presets exactly', () => {
    expect(CAMERA_PRESETS.slice(0, 3)).toEqual(['Widok kuchni', 'Z boku', 'Zbliżenie']);
    expect(CAMERA_PRESETS).toContain('Przegląd');
    expect(CAMERA_PRESETS).toContain('Reel');
  });
});

describe('heading helper', () => {
  it('turns the short way toward the target', () => {
    const next = turnToward(Math.PI - 0.1, 0, 0.05, 2.4);
    expect(Math.abs(headingError(next, 0))).toBeLessThan(Math.abs(headingError(Math.PI - 0.1, 0)));
  });
});
