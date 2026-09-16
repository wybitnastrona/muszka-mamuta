import { CAMERA_PRESETS, type CameraPreset } from '../body/types.ts';

export function nextCameraPreset(current: CameraPreset, delta: number): CameraPreset {
  const i = CAMERA_PRESETS.indexOf(current);
  const n = CAMERA_PRESETS.length;
  const at = ((i < 0 ? 0 : i) + delta) % n;
  return CAMERA_PRESETS[at < 0 ? at + n : at]!;
}

export function cameraPresetFromKey(current: CameraPreset, key: string): CameraPreset | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return nextCameraPreset(current, 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp') return nextCameraPreset(current, -1);
  if (key === 'Home') return CAMERA_PRESETS[0];
  if (key === 'End') return CAMERA_PRESETS[CAMERA_PRESETS.length - 1]!;
  return null;
}
