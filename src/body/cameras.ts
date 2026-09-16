import * as THREE from 'three';
import type { CameraPreset } from './types.ts';
import { CAMERA_PRESETS } from './types.ts';
import { kitchenLayout } from '../scene/layout.ts';
import { flyVisualLengthMm } from '../scene/scale.ts';

export { CAMERA_PRESETS, type CameraPreset };

export type CameraFrame = {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
};

/** High behind the fly, looking down so the pouch top (and label) reads as a flat pack. */
export function kitchenFrame(_radius = flyVisualLengthMm() / 2): CameraFrame {
  const { curd, pouch, fly } = kitchenLayout();
  return {
    position: [fly.x - 22, 248, fly.z - 90],
    lookAt: [(curd.x + pouch.x) * 0.4, 4, (fly.z + curd.z) * 0.15],
    fov: 32,
  };
}

export function sideFrame(radius = flyVisualLengthMm() / 2): CameraFrame {
  const { fly, biteFront } = kitchenLayout();
  return {
    position: [fly.x + Math.max(28, radius * 2.4), 12, fly.z + 8],
    lookAt: [biteFront.x, biteFront.y, biteFront.z],
    fov: 32,
  };
}

export function closeupOffset(radius = flyVisualLengthMm() / 2): [number, number, number] {
  const s = Math.max(8, radius * 0.55);
  return [s * 1.15, s * 0.4, s * 0.7];
}

export function labelCloseupFrame(label: THREE.Object3D): CameraFrame {
  const p = new THREE.Vector3();
  label.getWorldPosition(p);
  return {
    position: [p.x + 4, p.y + 95, p.z + 12],
    lookAt: [p.x, p.y, p.z],
    fov: 24,
  };
}

export function frameForPreset(preset: CameraPreset, radius: number): CameraFrame {
  if (preset === 'Z boku') return sideFrame(radius);
  if (preset === 'Zbliżenie') {
    const off = closeupOffset(radius);
    return { position: off, lookAt: [0, 0, 0.05], fov: 28 };
  }
  return kitchenFrame(radius);
}
