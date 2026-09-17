/**
 * Authored render-only motion polish. Does not write ActivityFrame or change
 * contact sampling — apply after the director has posed the bones.
 */
import * as THREE from 'three';
import type { BoneName } from './types.ts';
import { DEG, wrapPi } from './math.ts';
import {
  FOOT_SINK_MM,
  HANDHELD_AMP_MM,
  HANDHELD_HZ,
  HEAD_STABILIZE,
} from '../scene/proceduralMaps.ts';

const _world = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export function gazeStabilizeEuler(
  pitch: number,
  roll: number,
  amount = HEAD_STABILIZE,
): THREE.Euler {
  return new THREE.Euler(-amount * pitch, 0, -amount * roll, 'YXZ');
}

/** Counter-rotate the head 60% against body pitch/roll (gaze stabilisation). */
export function applyGazeStabilization(
  head: THREE.Bone,
  pitch: number,
  roll: number,
  amount = HEAD_STABILIZE,
): void {
  _e.set(-amount * pitch, 0, -amount * roll, 'YXZ');
  _q.setFromEuler(_e);
  head.quaternion.multiply(_q);
}

export const ANTENNA_FLICK_DEG = 8;
export const ANTENNA_FLICK_TRIGGER_RAD = 3 * DEG;

/** 8° flicks when the vanillin gradient yaw jumps; decay ~160 ms. */
export class AntennaFlick {
  prevYaw = Number.NaN;
  amp = 0;
  phase = 0;

  update(dt: number, odorYaw: number): number {
    if (Number.isFinite(this.prevYaw)) {
      const delta = Math.abs(wrapPi(odorYaw - this.prevYaw));
      if (delta > ANTENNA_FLICK_TRIGGER_RAD) this.amp = ANTENNA_FLICK_DEG;
    }
    this.prevYaw = odorYaw;
    this.amp *= Math.exp(-Math.max(0, dt) / 0.16);
    this.phase += Math.max(0, dt) * 26;
    return this.amp * Math.sin(this.phase);
  }
}

export function applyAntennaFlickDeg(
  bones: Map<BoneName, THREE.Bone>,
  deg: number,
): void {
  const rad = deg * DEG;
  bones.get('antenna_L')?.rotateY(rad);
  bones.get('antenna_R')?.rotateY(-rad);
}

/**
 * Restore authored rest translation, then sink `sinkMm` along world −Y.
 * Call every visual frame; do not run inside `sampleContacts`.
 */
export function applyFootContactOffset(
  bone: THREE.Bone,
  restLocal: THREE.Vector3,
  sinkMm: number,
): void {
  bone.position.copy(restLocal);
  if (sinkMm === 0 || !bone.parent) return;
  bone.updateMatrix();
  bone.updateWorldMatrix(true, false);
  bone.getWorldPosition(_world);
  _world.y -= sinkMm;
  bone.parent.worldToLocal(_world);
  bone.position.copy(_world);
}

export function standingFootSinkMm(mode: 'ground' | 'flight' | 'onFood' | 'mill'): number {
  return mode === 'flight' ? 0 : FOOT_SINK_MM;
}

export function handheldOffset(
  tSec: number,
  amp = HANDHELD_AMP_MM,
  hz = HANDHELD_HZ,
): THREE.Vector3 {
  const w = Math.PI * 2 * hz;
  return new THREE.Vector3(
    Math.sin(tSec * w) * amp,
    Math.cos(tSec * w * 1.17) * amp * 0.55,
    Math.sin(tSec * w * 0.81 + 0.4) * amp,
  );
}
