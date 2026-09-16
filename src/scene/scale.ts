/**
 * Kitchen / body scene units.
 *
 * One scene unit = 1 millimetre at render scale. The real fly is 2.5 mm;
 * FLY_RENDER_SCALE (8) is a documented visual exaggeration, so the on-screen
 * fly is 20 mm long. Food and packaging stay at true millimetre size, so the
 * 100 mm curd is large next to the (already oversized) fly — that is the
 * intended kitchen table, not a bug.
 *
 * Flybody's native mesh is ~0.301 units along +Z; `flyRootScale()` maps that
 * onto `REAL_FLY_BODY_MM * FLY_RENDER_SCALE`.
 */

export const REAL_FLY_BODY_MM = 2.5;
export const FLY_RENDER_SCALE = 8;

/** AABB z-span of `public/data/flybody/model.bin` (measured, not guessed). */
export const FLYBODY_NATIVE_LENGTH = 0.3012;

export const CURD_MM = { length: 100, width: 80, height: 30 };
export const POUCH_MM = { length: 130, width: 110, height: 32 };
export const SEAL_MM = 15;
export const CURD_ALBEDO_HEX = '#e1d7ca';

export const CURD_BEVEL_MM = 3;
export const CURD_TOP_RISE_MM = 2;
export const CURD_TILE = 2;
export const CURD_CHUNK_COUNT = 200;
export const CURD_DENSITY_G_CM3 = 1;
export const CURD_TOTAL_MASS_G = 250;
export const CURD_INTERIOR_LIGHTEN = 0.12;
export const CURD_INTERIOR_ROUGHNESS = 0.6;
export const CURD_NORMAL_SCALE = 1.4;
export const CURD_RIM_HEX = '#f6efdc';

export const POUCH_BEVEL_MM = 4;
export const POUCH_WRINKLE_MM = 1.5;
export const POUCH_FILM_THICKNESS = 0.5;
export const POUCH_FLANGE_THICK_MM = 2;
export const POUCH_YAW_DEG = 15;
export const LABEL_LIFT_MM = 1;
export const LABEL_IMAGE_W = 1024;
export const LABEL_IMAGE_H = 2048;

export const FLY_WALK_MM_S = 14;

/** Chunk LOD switches inside this many visual body lengths. */
export const LOD_BODY_LENGTHS = 3;
export const LOD_FADE_MS = 150;
/** Labellum / tarsus contact radius, in visual body lengths. */
export const CONTACT_RADIUS_BODY_LENGTHS = 0.3;
/** Spawn a fresh 250 g portion below this remaining fraction. */
export const ETERNITY_MASS_FRAC = 0.05;

export function lodDistanceMm(): number {
  return flyVisualLengthMm() * LOD_BODY_LENGTHS;
}

export function contactRadiusMm(): number {
  return flyVisualLengthMm() * CONTACT_RADIUS_BODY_LENGTHS;
}

export function lodFadeSec(): number {
  return LOD_FADE_MS / 1000;
}

/** Identity: scene units are millimetres at render scale. */
export function mm(valueMm: number): number {
  return valueMm;
}

export function flyVisualLengthMm(): number {
  return REAL_FLY_BODY_MM * FLY_RENDER_SCALE;
}

export function flyVisualHalfLengthMm(): number {
  return flyVisualLengthMm() / 2;
}

export function flyRootScale(): number {
  return flyVisualLengthMm() / FLYBODY_NATIVE_LENGTH;
}

/**
 * Rest labellum z in Flybody model units (`anchors.json` labellum_L / labellum_R).
 * Scaled by `flyRootScale()` this is the rest reach of the tip from the root.
 */
export const LABELLUM_REST_Z_NATIVE = 0.0657;

/** Rest labellum anterior of the root, millimetres at render scale. */
export function labellumRestReachMm(): number {
  return LABELLUM_REST_Z_NATIVE * flyRootScale();
}

/**
 * Length of a fully extended PER past the head-anterior, millimetres at render
 * scale. Authored from the PER Euler keys (rostrum −35°, haustellum −60°) so
 * the tip clears the head AABB; not a measured length.
 */
export function proboscisReachMm(): number {
  return Math.max(flyVisualLengthMm() * 0.25, labellumRestReachMm());
}

/**
 * How far the body root stays from the food surface so the labellum can
 * touch it while the body mesh stays clear: half visual body length plus
 * the extended proboscis.
 */
export function standoffMm(): number {
  return flyVisualHalfLengthMm() + proboscisReachMm();
}

/**
 * Anterior offset of the extended labellum from the body root. Equal to
 * `standoffMm()` so a root parked at the standoff point puts the tip on
 * the food surface.
 */
export function extendedLabellumReachMm(): number {
  return standoffMm();
}

/** Padding used when clamping the root so the body mesh stays outside food. */
export function bodyCollisionPadMm(): number {
  return flyVisualHalfLengthMm();
}

export const POUCH_INNER_MM = {
  length: POUCH_MM.length - 2 * SEAL_MM,
  width: POUCH_MM.width - 2 * SEAL_MM,
  height: POUCH_MM.height,
} as const;
