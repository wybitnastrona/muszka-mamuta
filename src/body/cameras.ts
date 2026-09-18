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

export const REEL_ASPECT = 9 / 16;

/**
 * Pull-back from the tub/mill look-at, not a 5× mesh scale (that breaks gait).
 * Previous mill-only crop (lookAt on the deck, camera on mill.x) hid the KFD.
 */
export const KITCHEN_FRAMING = 0.95;

/** 3/4 kitchen: tub wrap + mill LED as one pair. Scene mm stay 1:1. */
export function kitchenFrame(_radius = flyVisualLengthMm() / 2): CameraFrame {
  const { tub, mill } = kitchenLayout();
  const lookAt: [number, number, number] = [
    (tub.x + mill.x) * 0.5,
    Math.max(52, tub.height * 0.38),
    mill.z,
  ];
  const spanX = (mill.x + mill.hx) - (tub.x - tub.diameter / 2);
  const dist = Math.max(280, spanX * KITCHEN_FRAMING);
  return {
    position: [
      lookAt[0] + 36,
      Math.max(168, tub.height * 1.18),
      lookAt[2] - dist,
    ],
    lookAt,
    fov: 48,
  };
}

export function sideFrame(radius = flyVisualLengthMm() / 2): CameraFrame {
  const { fly, biteFront } = kitchenLayout();
  return {
    position: [fly.x + Math.max(28, radius * 2.4), 14, fly.z + 8],
    lookAt: [biteFront.x, biteFront.y, biteFront.z],
    fov: 32,
  };
}

export function closeupOffset(radius = flyVisualLengthMm() / 2): [number, number, number] {
  const s = Math.max(flyVisualLengthMm() * 0.4, radius * 0.55);
  return [s * 1.15, s * 0.4, s * 0.7];
}

export function labelCloseupFrame(label: THREE.Object3D): CameraFrame {
  const p = new THREE.Vector3();
  label.getWorldPosition(p);
  const { tub } = kitchenLayout();
  const dir = new THREE.Vector3(p.x - tub.x, 0, p.z - tub.z);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
  dir.normalize();
  const pull = Math.max(250, tub.height * 1.75);
  return {
    position: [p.x + dir.x * pull, p.y + tub.height * 0.08, p.z + dir.z * pull],
    lookAt: [p.x, p.y, p.z],
    fov: 28,
  };
}

/** Front of the KFD wrap (local −Z, yaw'd toward the mill / +X). */
export function tubLabelFrame(): CameraFrame {
  const { tub } = kitchenLayout();
  const r = tub.diameter / 2;
  const yaw = tub.yaw;
  const frontX = tub.x + Math.sin(-yaw) * r;
  const frontZ = tub.z - Math.cos(-yaw) * r;
  const pull = Math.max(250, tub.height * 1.75);
  const labelY = tub.y + tub.height * 0.12;
  const dx = frontX - tub.x;
  const dz = frontZ - tub.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  return {
    position: [frontX + ux * pull, labelY + tub.height * 0.08, frontZ + uz * pull],
    lookAt: [frontX, labelY, frontZ],
    fov: 28,
  };
}

/**
 * Faza 4 review camera: 3/4 of the fly from the mill / +X side, outside
 * the KFD well (the spawn used to sit on a board; a close +Z dolly is now
 * inside the cylinder).
 */
export function overviewFrame(radius = flyVisualLengthMm() / 2): CameraFrame {
  const { fly, tub } = kitchenLayout();
  const s = Math.max(42, radius * 3.8);
  return {
    position: [fly.x + s * 1.4, Math.max(20, s * 0.7), fly.z - s * 0.45],
    lookAt: [fly.x, Math.max(6, tub.height * 0.05), fly.z],
    fov: 34,
  };
}

/**
 * Studio reel: 9:16, 35 mm-equivalent (~38° vertical FOV), 15° above the
 * table (low angle). Fly, powder and mill sit in the middle third.
 */
export function reelFrame(_radius = flyVisualLengthMm() / 2): CameraFrame {
  const { fly, pile } = kitchenLayout();
  const lookAt: [number, number, number] = [
    (fly.x + pile.x) * 0.45,
    10,
    (fly.z + pile.z) * 0.45,
  ];
  const dist = 700;
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

export function letterboxSize(
  viewW: number,
  viewH: number,
  aspect = REEL_ASPECT,
): { width: number; height: number; x: number; y: number } {
  if (viewW / Math.max(viewH, 1e-6) > aspect) {
    const width = viewH * aspect;
    return { width, height: viewH, x: (viewW - width) / 2, y: 0 };
  }
  const height = viewW / aspect;
  return { width: viewW, height, x: 0, y: (viewH - height) / 2 };
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
  if (preset === 'Etykieta') return tubLabelFrame();
  if (preset === 'Przegląd') return overviewFrame(radius);
  if (preset === 'Reel') return reelFrame(radius);
  return kitchenFrame(radius);
}
