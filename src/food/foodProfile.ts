/**
 * Authored food chemistry — not measured in MaleCNS.
 *
 * The on-screen wedge is twaróg Mamuta waniliowy (vanilla-sweetened farmer's
 * cheese), not plain curd. MaleCNS has no sweet/bitter receptor split, so these
 * numbers never select a sugar-only subset of gustatory seeds. They only scale
 * hemolymph yields (`src/metabolism/hemolymph.ts`): `sweet` → trehalose,
 * `aa` → fat/repletion.
 *
 * Olfactory `odor` (vanillin) is detected at distance, not by taste, and does
 * not enter the gut ODEs.
 */

export type FoodProfile = {
  sweet: number;
  aa: number;
  sour: number;
  bitter: number;
  odor: number;
  albedoHex: string;
};

/** Live-sim default. Authored assumption: the wedge is the vanilla variant. */
export const TWAROG_MAMUTA_WANILIOWY: FoodProfile = {
  sweet:  0.75,   // added sugar in the vanilla variant — the main drive
  aa:     0.70,   // milk protein, ~18 g / 100 g
  sour:   0.25,   // curd acidity, milder than plain
  bitter: 0.03,
  odor:   0.85,   // vanillin — OLFACTORY, detected at distance, not by taste
  albedoHex: '#e1d7ca',
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
  albedoHex: '#e1d7ca',
};
