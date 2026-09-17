/**
 * Studio fog is FogExp2 tinted from the grid floor. Photo mode has no fog:
 * the still already carries depth cues and a linear-to-black fog would eat it.
 */
import * as THREE from 'three';

/** Sampled from the Faza 8 `gridFloor` mesh (`0x07080c`), not pure black. */
export const GRID_FLOOR_FOG = 0x07080c;
export const STUDIO_FOG_AT_BOARD = 0.12;
export const STUDIO_FOG_CAP = 0.25;

export function fogExp2Factor(distance: number, density: number): number {
  if (distance <= 0 || density <= 0) return 0;
  return 1 - Math.exp(-density * distance);
}

export function fogExp2DensityForFactor(distance: number, factor: number): number {
  const f = Math.min(Math.max(factor, 0), 0.999);
  return -Math.log(1 - f) / Math.max(distance, 1e-3);
}

export function boardFogFactor(camera: THREE.Vector3, board: THREE.Vector3, density: number): number {
  return fogExp2Factor(camera.distanceTo(board), density);
}

/**
 * Density so the board (and the fly on it) stay at `STUDIO_FOG_AT_BOARD`
 * when the camera moves. Hard-capped at 25% contribution on the subject.
 */
export function studioFogDensity(cameraToBoard: number): number {
  const capped = Math.min(STUDIO_FOG_AT_BOARD, STUDIO_FOG_CAP);
  return fogExp2DensityForFactor(cameraToBoard, capped);
}

export function updateStudioFog(
  scene: THREE.Scene,
  camera: THREE.Camera,
  board: THREE.Vector3,
): number {
  camera.updateMatrixWorld();
  const cam = new THREE.Vector3();
  camera.getWorldPosition(cam);
  const dist = cam.distanceTo(board);
  const density = studioFogDensity(dist);
  const fog = scene.fog;
  if (fog instanceof THREE.FogExp2) {
    fog.density = density;
    fog.color.setHex(GRID_FLOOR_FOG);
  } else {
    scene.fog = new THREE.FogExp2(GRID_FLOOR_FOG, density);
  }
  return fogExp2Factor(dist, density);
}
