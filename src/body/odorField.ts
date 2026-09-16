import { clamp01 } from './math.ts';

import { flyVisualLengthMm } from '../scene/scale.ts';

/**
 * Authored vanillin plume — long-range 1/r, not a measured concentration.
 *
 * This field drives FeedingStateMachine ORIENT steering only. It must never
 * be converted into a Poisson rate on MN9 (or any motor neuron): MaleCNS
 * olfactory pathways are not in the extracted feeding subgraph. Taste
 * contact uses a separate short-range sampler that stimulates gust_labellar
 * / gust_pharyngeal via BrainRuntime.stimulate().
 */
export const ODOR_R0 = flyVisualLengthMm() * 12;
/** @deprecated Alias of ODOR_R0; kept so older tests still compile. */
export const ODOR_SIGMA = ODOR_R0;
export const ODOR_DETECT = 0.08;

export type XZ = { x: number; z: number };

export function odorConcentration(
  pos: XZ,
  food: XZ,
  strength: number,
  r0 = ODOR_R0,
): number {
  const r = Math.hypot(pos.x - food.x, pos.z - food.z);
  return clamp01(strength) * (r0 / (r + r0));
}

/** Yaw toward the food. Gradient of 1/r is radial, so this is exact. */
export function odorGradientYaw(pos: XZ, food: XZ): number {
  return Math.atan2(food.x - pos.x, food.z - pos.z);
}
