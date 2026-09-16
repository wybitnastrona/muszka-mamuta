/**
 * Push hemolymph neuromodulation into the LIF worker.
 *
 * MaleCNS has no sweet/bitter receptor annotations, so hunger scales the
 * **whole** gustatory channel — every proboscis seed role present in the
 * graph (`gust_drive` / `gust_neutral` / `gust_suppress`, which are the
 * labellar + pharyngeal cells split by measured ΔMN9, plus the legacy
 * anatomical tags). We do not invent a sugar-only gain.
 *
 * Inhibition is not applied here: GABA and glutamate edges already sit in
 * the extracted CSR.
 */

import type { BrainRuntime } from '../brain/BrainRuntime.ts';
import { ANATOMICAL_GUST_ROLES, MEASURED_GUST_ROLES, type RoleTag } from '../brain/params.ts';
import type { Modulation } from './hemolymph.ts';

/** How often the main thread posts gain/threshold to the worker. */
export const MODULATION_PUSH_MS = 250;

/** Whole gustatory channel. Live graph uses measured terciles; anatomical tags still parse. */
export const GUST_GAIN_ROLES: readonly RoleTag[] = [
  ...MEASURED_GUST_ROLES,
  ...ANATOMICAL_GUST_ROLES,
];

export function pushModulation(runtime: BrainRuntime, mod: Modulation): void {
  for (const role of GUST_GAIN_ROLES) runtime.setGain(role, mod.gustGain);
  runtime.setMn9ThresholdShift(mod.mn9ThresholdShift);
}
