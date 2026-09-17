/**
 * Authored food chemistry — not measured in MaleCNS.
 *
 * Live food is creatine monohydrate powder (`CREATINE_KFD`). MaleCNS v1.0
 * annotations were searched for creatine|kreatyn|Ir76b|Ir94|amino: **zero
 * hits** (211 577 bodies). No new seeds. The same whole gustatory channel
 * (labellar / taste peg / pharyngeal) is stimulated; these numbers never
 * select a receptor-gene subset. They only scale hemolymph yields
 * (`src/metabolism/hemolymph.ts`): `sweet` → trehalose, `aa` → fat/repletion.
 *
 * Olfactory `odor` (dry powder plume) is detected at distance, not by taste,
 * and does not enter the gut ODEs.
 *
 * Chemosensory split (see `src/food/twarogSystem.ts` / `creatineSystem.ts`):
 *   - CONTACT fields `sweet` / `aa` / `sour` / `bitter` are short-range and
 *     become Poisson rates on gust_labellar + gust_pharyngeal.
 *   - `odor` is a long-range 1/r plume that steers ORIENT only.
 *     It is never written onto MN9; MaleCNS olfactory pathways are not in
 *     the extracted feeding subgraph.
 */
import { CREATINE_ALBEDO_HEX, CURD_ALBEDO_HEX } from '../scene/scale.ts';

export type FoodProfile = {
  sweet: number;
  aa: number;
  sour: number;
  bitter: number;
  odor: number;
  albedoHex: string;
};

/**
 * Live-sim default. Authored: unflavoured creatine as nitrogenous / aa-like
 * contact chemistry. Not a MaleCNS creatine sensor.
 */
export const CREATINE_KFD: FoodProfile = {
  sweet: 0.05,
  aa: 0.85,
  sour: 0.02,
  bitter: 0.08,
  odor: 0.55,
  albedoHex: CREATINE_ALBEDO_HEX,
};

/** Fixture only (tests / docs). Not served in the live sim. */
export const TWAROG_MAMUTA_WANILIOWY: FoodProfile = {
  sweet:  0.75,   // added sugar in the vanilla variant — the main drive
  aa:     0.70,   // milk protein, ~18 g / 100 g
  sour:   0.25,   // curd acidity, milder than plain
  bitter: 0.03,
  odor:   0.85,   // vanillin — OLFACTORY, detected at distance, not by taste
  albedoHex: CURD_ALBEDO_HEX,
};

/**
 * Comparison fixture only (tests / docs). Not served in the live sim.
 * Same protein as the vanilla wedge; unsweetened curd sugar is low.
 */
export const TWAROG_PLAIN_UNSWEETENED: FoodProfile = {
  sweet: 0.15,
  aa: 0.70,
  sour: 0.40,
  bitter: 0.05,
  odor: 0.35,
  albedoHex: CURD_ALBEDO_HEX,
};
