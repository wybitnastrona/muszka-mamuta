/**
 * Authored LIF constants, Shiu et al. 2024 style.
 *
 * Shiu PK et al., Nature 634, 2024. https://doi.org/10.1038/s41586-024-07763-9
 * Methods: current-based LIF with exponential synaptic drive g,
 *   dv/dt = (g − (v − V_rest)) / τ_m
 *   dg/dt = −g / τ_syn
 *   on spike of j: g_i += w_ji × W_syn   (w_ji = signed synapse count)
 *
 * τ_m = C_m R_m = 2 µF cm⁻² × 10 kΩ cm² = 20 ms
 *   (Kakaria & de Bivort 2017, as used by Shiu).
 * V_rest / V_reset / V_th from Kakaria & de Bivort 2017.
 * Refractory 2.2 ms: Kakaria & de Bivort 2017; Lazar et al. 2021.
 * τ_syn = 5 ms: Jürgensen et al. 2021 (Shiu Methods).
 * W_syn = 0.275 mV: Shiu's single free parameter, chosen so that 100 Hz
 *   sugar-GRN drive yielded ~80% of maximal MN9 firing in FlyWire. Here the
 *   same number is applied to MaleCNS signed synapse counts — an authored
 *   transfer of their parameter, not a new fit.
 *
 * dt = 0.1 ms is our integration step (not a biological measurement).
 * Axonal delay T_dly = 1.8 ms from the paper is omitted.
 * These values are authored model parameters, not measured in MaleCNS.
 */

export type RoleTag =
  | 'gust_drive'
  | 'gust_neutral'
  | 'gust_suppress'
  | 'gust_labellar'
  | 'gust_pharyngeal'
  | 'mn9'
  | 'mn_other'
  | 'dn'
  | 'interneuron';

/** Canonical live-model roles. Anatomical gust_* tags are accepted when reading older meta. */
export const ROLE_TAGS: readonly RoleTag[] = [
  'gust_drive',
  'gust_neutral',
  'gust_suppress',
  'gust_labellar',
  'gust_pharyngeal',
  'mn9',
  'mn_other',
  'dn',
  'interneuron',
];

export const MEASURED_GUST_ROLES = ['gust_drive', 'gust_neutral', 'gust_suppress'] as const;
export const ANATOMICAL_GUST_ROLES = ['gust_labellar', 'gust_pharyngeal'] as const;
export const LABELLAR_SUBCLASSES = ['labellar bristle', 'taste peg'] as const;
export const PHARYNGEAL_SUBCLASSES = ['pharyngeal sensillum'] as const;
export const GUSTATORY_SUBCLASSES = [...LABELLAR_SUBCLASSES, ...PHARYNGEAL_SUBCLASSES] as const;

/** Integration step. Authored numerical choice. */
export const DT_MS = 0.1;

/** Membrane time constant τ_m = C_m R_m. Shiu / Kakaria & de Bivort 2017. */
export const TAU_M_MS = 20;

/** Resting potential. Shiu Methods; Kakaria & de Bivort 2017. */
export const V_REST_MV = -52;

/** Spike threshold. Shiu Methods; Kakaria & de Bivort 2017. */
export const V_TH_MV = -45;

/** Reset potential after a spike. Shiu Methods; Kakaria & de Bivort 2017. */
export const V_RESET_MV = -52;

/** Absolute refractory period. Shiu Methods; Kakaria & de Bivort 2017. */
export const T_REFRACTORY_MS = 2.2;

/**
 * Voltage increment of g per (signed) synapse.
 * Shiu et al. 2024, free parameter W_syn.
 */
export const W_SYN_MV = 0.275;

/** Exponential synaptic-current decay. Shiu Methods; Jürgensen et al. 2021. */
export const TAU_SYN_MS = 5;

/** Wall-clock frame period for the live adapter (~60 Hz). */
export const FRAME_MS = 16.7;

/** Sliding window for displayed / normalized firing rate. */
export const RATE_WINDOW_MS = 50;

/** ActivityFrame normalization: rate_Hz / 50, clamped to [0, 1]. */
export const RATE_NORM_HZ = 50;

/**
 * Inclusive MN9 rest band. Authored from typical quiescent motor-neuron
 * idling (~1–5 Hz), not a MaleCNS measurement. Calibration searches
 * BACKGROUND_RATE_HZ until mean MN9 lands here (scripts/calibrate_background.ts).
 */
export const MN9_REST_TARGET_MIN_HZ = 2;
export const MN9_REST_TARGET_MAX_HZ = 5;

/**
 * Tonic Poisson rate on every proboscis gustatory seed (labellar, peg,
 * pharyngeal). Written by `scripts/calibrate_background.ts`.
 *
 * Target: mean MN9 rest in [MN9_REST_TARGET_MIN_HZ, MN9_REST_TARGET_MAX_HZ]
 * so fold-changes are defined without a permanently extended proboscis.
 * 2 Hz on 271 seeds produced 29 Hz MN9 — that is feeding, not rest.
 * Do not raise this number to make a validation threshold pass.
 */
export const BACKGROUND_RATE_HZ = 0.25;

/** Mean MN9 Hz at BACKGROUND_RATE_HZ (seed 1, PROTOCOL_DURATION_MS). Written by calibrate_background.ts. */
export const CALIBRATED_MN9_REST_HZ = 3.75;

/** Shared seed for measure_drive / validate_per / calibrate_background. */
export const PROTOCOL_SEED = 1;

/** Shared stimulus for per-seed drive measurement and population validation. */
export const PROTOCOL_STIM_HZ = 100;

/** Shared pulse length for measure_drive and validate_per. */
export const PROTOCOL_DURATION_MS = 500;

/**
 * Window for resting MN9 (calibrate_background, measure/validate baseline).
 * 500 ms is too short: MN9 is silent or bursting (≥9 Hz), never 2–5 Hz.
 * Mean rest is therefore taken over 2000 ms.
 */
export const REST_WINDOW_MS = 2000;

export const FRAME_STEPS = Math.round(FRAME_MS / DT_MS);
export const RATE_WINDOW_STEPS = Math.round(RATE_WINDOW_MS / DT_MS);
export const REFRACTORY_STEPS = Math.round(T_REFRACTORY_MS / DT_MS);

/** Analytic LIF rate for constant current I_ext (same units as g, mV). */
export function analyticLifRateHz(iExtMv: number): number {
  const delta = V_TH_MV - V_REST_MV;
  if (iExtMv <= delta) return 0;
  const tRise = TAU_M_MS * Math.log(iExtMv / (iExtMv - delta));
  return 1000 / (tRise + T_REFRACTORY_MS);
}

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
