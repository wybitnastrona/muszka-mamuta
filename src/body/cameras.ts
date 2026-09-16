import * as THREE from 'three';
import type { CameraPreset } from './types.ts';
import { CAMERA_PRESETS } from './types.ts';
import { kitchenLayout } from '../scene/layout.ts';
import { flyVisualLengthMm } from '../scene/scale.ts';
import { REEL_ELEV_DEG, REEL_FOV_DEG } from '../scene/proceduralMaps.ts';

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

/**
 * Faza 4 review camera: 3/4 front-left of the fly, whole head and first
 * legs in frame, pulled back enough that the mesh is not clipped.
 */
export function overviewFrame(radius = flyVisualLengthMm() / 2): CameraFrame {
  const { fly, biteFront } = kitchenLayout();
  const s = Math.max(22, radius * 1.55);
  return {
    position: [fly.x + s * 1.05, s * 0.48, fly.z + s * 0.88],
    lookAt: [fly.x, Math.max(3.5, biteFront.y * 0.4), fly.z + flyVisualLengthMm() * 0.22],
    fov: 30,
  };
}

/**
 * 35 mm-equivalent (~38° vertical FOV), 15° above the table, fly and food
 * composed in the middle third. Handheld drift and DOF are applied in the mount.
 */
export function reelFrame(_radius = flyVisualLengthMm() / 2): CameraFrame {
  const { fly, curd } = kitchenLayout();
  const lookAt: [number, number, number] = [
    (fly.x + curd.x) * 0.5,
    8,
    (fly.z + curd.z) * 0.5,
  ];
  const dist = 168;
  const elev = (REEL_ELEV_DEG * Math.PI) / 180;
  const yaw = -2.35;
  const horiz = dist * Math.cos(elev);
  return {
    position: [
      lookAt[0] + horiz * Math.sin(yaw),
      lookAt[1] + dist * Math.sin(elev),
      lookAt[2] + horiz * Math.cos(yaw),
    ],
    lookAt,
    fov: REEL_FOV_DEG,
  };
}

export function usesShallowDof(preset: CameraPreset): boolean {
  return preset === 'Zbliżenie' || preset === 'Reel';
}

export const CLOSEUP_APERTURE = 0.00048;
export const REEL_APERTURE = 0.00022;
export const CLOSEUP_MAXBLUR = 0.018;
export const REEL_MAXBLUR = 0.012;

export function frameForPreset(preset: CameraPreset, radius: number): CameraFrame {
  if (preset === 'Z boku') return sideFrame(radius);
  if (preset === 'Zbliżenie') {
    const off = closeupOffset(radius);
    return { position: off, lookAt: [0, 0, 0.05], fov: 28 };
  }
  if (preset === 'Przegląd') return overviewFrame(radius);
  if (preset === 'Reel') return reelFrame(radius);
  return kitchenFrame(radius);
}
