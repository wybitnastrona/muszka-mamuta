import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  AntennaFlick,
  ANTENNA_FLICK_DEG,
  applyFootContactOffset,
  applyGazeStabilization,
  gazeStabilizeEuler,
  handheldOffset,
  standingFootSinkMm,
} from '../../src/body/appearanceMotion.ts';
import { HEAD_STABILIZE } from '../../src/scene/proceduralMaps.ts';

describe('gaze stabilisation', () => {
  it('counter-rotates 60% against body pitch and roll', () => {
    expect(HEAD_STABILIZE).toBeCloseTo(0.6);
    const e = gazeStabilizeEuler(0.4, -0.2);
    expect(e.x).toBeCloseTo(-0.6 * 0.4);
    expect(e.z).toBeCloseTo(-0.6 * -0.2);
    const head = new THREE.Bone();
    head.quaternion.identity();
    applyGazeStabilization(head, 0.5, 0);
    const e2 = new THREE.Euler().setFromQuaternion(head.quaternion, 'YXZ');
    expect(e2.x).toBeCloseTo(-0.3);
  });
});

describe('antenna flicks', () => {
  it('stays near zero without a yaw jump, then hits 8° on a gradient change', () => {
    const flick = new AntennaFlick();
    expect(flick.update(1 / 60, 0)).toBeCloseTo(0, 5);
    const jumped = flick.update(1 / 60, 0.4);
    expect(Math.abs(jumped)).toBeGreaterThan(0.5);
    expect(flick.amp).toBeCloseTo(ANTENNA_FLICK_DEG * Math.exp(-1 / 60 / 0.16), 3);
  });
});

describe('foot contact', () => {
  it('lifts pads off the deck on standing modes and restores rest translation', () => {
    expect(standingFootSinkMm('ground')).toBeCloseTo(-0.45);
    expect(standingFootSinkMm('onFood')).toBeCloseTo(-0.45);
    expect(standingFootSinkMm('flight')).toBe(0);
    const parent = new THREE.Group();
    const bone = new THREE.Bone();
    parent.add(bone);
    const rest = new THREE.Vector3(0, 2, 0);
    applyFootContactOffset(bone, rest, -0.45);
    const world = new THREE.Vector3();
    bone.getWorldPosition(world);
    expect(world.y).toBeCloseTo(2.45);
    applyFootContactOffset(bone, rest, -0.45);
    bone.getWorldPosition(world);
    expect(world.y).toBeCloseTo(2.45);
  });
});

describe('handheld drift', () => {
  it('is 1 mm amplitude at 0.1 Hz', () => {
    const a = handheldOffset(0);
    const b = handheldOffset(2.5);
    expect(a.length()).toBeLessThan(1.2);
    expect(Math.abs(b.x)).toBeLessThanOrEqual(1 + 1e-9);
    expect(a.distanceTo(b)).toBeGreaterThan(0.2);
  });
});
