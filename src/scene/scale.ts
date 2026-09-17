/**
 * Kitchen / body scene units.
 *
 * One scene unit = 1 millimetre at render scale. The real fly is 2.5 mm;
 * FLY_RENDER_SCALE (4) is a documented visual exaggeration, so the on-screen
 * fly is 10 mm long against the 100 mm twaróg block (1:10 instead of the
 * previous 1:5; the true ratio is 1:40). Food and packaging stay at true
 * millimetre size.
 *
 * Flybody's native mesh is ~0.301 units along +Z; `flyRootScale()` maps that
 * onto `REAL_FLY_BODY_MM * FLY_RENDER_SCALE`. Standoff, contact radius, LOD
 * distance, collision padding, close-up framing and crumb size all derive
 * from that length — do not hard-code millimetre copies.
 */

export const REAL_FLY_BODY_MM = 2.5;
export const FLY_RENDER_SCALE = 4;

/** AABB z-span of `public/data/flybody/model.bin` (measured, not guessed). */
export const FLYBODY_NATIVE_LENGTH = 0.3012;

export const CURD_MM = { length: 100, width: 80, height: 30 };
/** End-grain oak cutting board. Length along +X, width along +Z, sits on the table. */
export const BOARD_MM = { length: 400, width: 300, height: 40 };
export const BOARD_EDGE_RADIUS_MM = 6;
export const BOARD_YAW_DEG = 12;
export const BOARD_LOGO_WIDTH_MM = 120;
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
/** Fine wrinkle amplitude on the empty film (mm). */
export const POUCH_WRINKLE_MM = 0.8;
/** MeshPhysicalMaterial thickness for thin PET. */
export const POUCH_FILM_THICKNESS = 0.15;
export const POUCH_FLANGE_THICK_MM = 2;
/** Collapsed empty-pouch rest height, not the original 32 mm filled pack. */
export const POUCH_BASE_HEIGHT_MM = 2.5;
export const POUCH_WIDTH_SEGMENTS = 40;
export const POUCH_DEPTH_SEGMENTS = 32;
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

export function contactRadiusAt(scale: number): number {
  return flyVisualLengthAt(scale) * CONTACT_RADIUS_BODY_LENGTHS;
}

export function contactRadiusMm(): number {
  return contactRadiusAt(FLY_RENDER_SCALE);
}

export function lodFadeSec(): number {
  return LOD_FADE_MS / 1000;
}

/** Identity: scene units are millimetres at render scale. */
export function mm(valueMm: number): number {
  return valueMm;
}

/** World Y of the cutting-board top (table top is y = 0). */
export function boardTopY(): number {
  return mm(BOARD_MM.height);
}

export function flyVisualLengthAt(scale: number): number {
  return REAL_FLY_BODY_MM * scale;
}

export function flyVisualLengthMm(): number {
  return flyVisualLengthAt(FLY_RENDER_SCALE);
}

export function flyVisualHalfLengthMm(): number {
  return flyVisualLengthMm() / 2;
}

export function flyRootScaleAt(scale: number): number {
  return flyVisualLengthAt(scale) / FLYBODY_NATIVE_LENGTH;
}

export function flyRootScale(): number {
  return flyRootScaleAt(FLY_RENDER_SCALE);
}

/**
 * Rest labellum z in Flybody model units (`anchors.json` labellum_L / labellum_R).
 * Scaled by `flyRootScale()` this is the rest reach of the tip from the root.
 */
export const LABELLUM_REST_Z_NATIVE = 0.0657;

/** Rest labellum anterior of the root, millimetres at render scale. */
export function labellumRestReachAt(scale: number): number {
  return LABELLUM_REST_Z_NATIVE * flyRootScaleAt(scale);
}

export function labellumRestReachMm(): number {
  return labellumRestReachAt(FLY_RENDER_SCALE);
}

/**
 * Length of a fully extended PER past the head-anterior, millimetres at render
 * scale. Authored from the PER Euler keys (rostrum −35°, haustellum −60°) so
 * the tip clears the head AABB; not a measured length.
 */
export function proboscisReachAt(scale: number): number {
  return Math.max(flyVisualLengthAt(scale) * 0.25, labellumRestReachAt(scale));
}

export function proboscisReachMm(): number {
  return proboscisReachAt(FLY_RENDER_SCALE);
}

/**
 * How far the body root stays from the food surface so the labellum can
 * touch it while the body mesh stays clear: half visual body length plus
 * the extended proboscis.
 */
export function standoffAt(scale: number): number {
  return flyVisualLengthAt(scale) / 2 + proboscisReachAt(scale);
}

export function standoffMm(): number {
  return standoffAt(FLY_RENDER_SCALE);
}

/**
 * Anterior offset of the extended labellum from the body root. Equal to
 * `standoffMm()` so a root parked at the standoff point puts the tip on
 * the food surface.
 */
export function extendedLabellumReachAt(scale: number): number {
  return standoffAt(scale);
}

export function extendedLabellumReachMm(): number {
  return extendedLabellumReachAt(FLY_RENDER_SCALE);
}

/** Padding used when clamping the root so the body mesh stays outside food. */
export function bodyCollisionPadAt(scale: number): number {
  return flyVisualLengthAt(scale) / 2;
}

export function bodyCollisionPadMm(): number {
  return bodyCollisionPadAt(FLY_RENDER_SCALE);
}

/** Crumb particle size, scaled with the fly (0.08 visual body lengths). */
export function crumbSizeMm(): number {
  return flyVisualLengthMm() * 0.08;
}

export const POUCH_INNER_MM = {
  length: POUCH_MM.length - 2 * SEAL_MM,
  width: POUCH_MM.width - 2 * SEAL_MM,
  height: POUCH_MM.height,
} as const;
