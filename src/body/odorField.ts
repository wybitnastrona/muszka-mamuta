import { clamp01 } from './math.ts';

/** Authored vanillin plume. Not a measured concentration field. */
export const ODOR_SIGMA = 0.22;
export const ODOR_DETECT = 0.08;

export type XZ = { x: number; z: number };

export function odorConcentration(
  pos: XZ,
  food: XZ,
  strength: number,
  sigma = ODOR_SIGMA,
): number {
  const dx = pos.x - food.x;
  const dz = pos.z - food.z;
  const g = Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma));
  return clamp01(strength) * g;
}

/** Yaw of the strongest local gradient (toward the food in this Gaussian). */
export function odorGradientYaw(pos: XZ, food: XZ): number {
  return Math.atan2(food.x - pos.x, food.z - pos.z);
}
