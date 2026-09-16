import type { CameraPreset } from './types.ts';
import { CAMERA_PRESETS } from './types.ts';

export { CAMERA_PRESETS, type CameraPreset };

export type CameraFrame = {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
};

export function kitchenFrame(radius: number): CameraFrame {
  const d = Math.max(0.18, radius * 2.4);
  return {
    position: [d * 0.72, d * 0.55, d * 0.85],
    lookAt: [0, -radius * 0.15, 0],
    fov: 38,
  };
}

export function sideFrame(radius: number): CameraFrame {
  const d = Math.max(0.16, radius * 2.1);
  return {
    position: [d, d * 0.12, d * 0.08],
    lookAt: [0, -radius * 0.08, radius * 0.12],
    fov: 32,
  };
}

export function closeupOffset(radius: number): [number, number, number] {
  const s = Math.max(0.12, radius * 0.5);
  return [s * 1.15, s * 0.35, s * 0.7];
}

export function frameForPreset(preset: CameraPreset, radius: number): CameraFrame {
  if (preset === 'Z boku') return sideFrame(radius);
  if (preset === 'Zbliżenie') {
    const off = closeupOffset(radius);
    return { position: off, lookAt: [0, 0, 0.05], fov: 28 };
  }
  return kitchenFrame(radius);
}
