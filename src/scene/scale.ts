/**
 * Kitchen / body scene units.
 *
 * One scene unit = 1 millimetre at render scale. The real fly is 2.5 mm;
 * FLY_RENDER_SCALE (6) is a documented visual exaggeration, so the on-screen
 * fly is 15 mm long against the authored KFD tub (~50 mm across). Raised
 * from 4× so she reads on a 1080×1920 reel. The unused twaróg / pouch
 * constants stay at true millimetre size for fixtures.
 *
 * Flybody's native mesh is ~0.301 units along +Z; `flyRootScale()` maps that
 * onto `REAL_FLY_BODY_MM * FLY_RENDER_SCALE`. Standoff, contact radius, LOD
 * distance, collision padding, close-up framing and crumb size all derive
 * from that length — do not hard-code millimetre copies.
 */

export const REAL_FLY_BODY_MM = 2.5;
export const FLY_RENDER_SCALE = 6;

/** AABB z-span of `public/data/flybody/model.bin` (measured, not guessed). */
export const FLYBODY_NATIVE_LENGTH = 0.3012;

export const CURD_MM = { length: 100, width: 80, height: 30 };
/**
 * Powder fill inside the tub well. Radius stays inside `tubInnerRadiusMm()`.
 * Height is the authored fill (near the rim, with scoop headroom).
 */
export const PILE_MM = { radius: 20, height: 14 };
export const PILE_CELL_COUNT = 80;
export const PILE_TOTAL_MASS_G = 250;
export const CREATINE_ALBEDO_HEX = '#e6e2d8';
/** Fly-scale scoop (authored). A real creatine scoop is 50–80 mm. */
export const SCOOP_MM = { bowlRadius: 5.5, bowlDepth: 4, handleLength: 12, handleRadius: 0.9 };
export const SCOOP_CAPACITY_G = 4;
export const SCOOP_EMPTY_S = 8;
/** Lab mill on the table. Belt top is `deck` above y = 0. */
export const MILL_MM = { length: 120, width: 50, height: 22, deck: 8 };
/**
 * KFD tub, fly-readable millimetres (authored). Photo wrap is the real
 * label; Ø/H are not the 500 g jar. Aspect from product shots is ~1.29
 * including the lid; the live body is shorter so the 15 mm fly can dip.
 */
export const TUB_MM = {
  diameter: 50,
  height: 26,
  wall: 2,
  lidDiameter: 52,
  lidHeight: 6,
};
/** @deprecated Use `TUB_MM`. Same diameter / height. */
export const TUB_SLOT_MM = { diameter: TUB_MM.diameter, height: TUB_MM.height };
/** End-grain oak cutting board (module kept; live scene no longer mounts it). */
export const BOARD_MM = { length: 400, width: 300, height: 40 };
export const BOARD_EDGE_RADIUS_MM = 6;
export const BOARD_YAW_DEG = 12;
export const BOARD_LOGO_WIDTH_MM = 120;
export const POUCH_MM = { length: 130, width: 110, height: 32 };
export const SEAL_MM = 15;
export const CURD_ALBEDO_HEX = '#e1d7ca';

/**
 * Opening bite carved into every fresh portion (authored, not measured): a
 * corner notch open to the top and to two side walls, so the fly can stand
 * in it. Anchor is on the top face as fractions of the XZ half-extents; the
 * carve region is an ellipsoid with `radiusXz` in XZ and `depth` downward.
 * Voronoi cells whose centroid falls inside start out eaten (21 cells,
 * ~26 g at seed 1). With the 30 mm block and 5 cell layers the lower layers
 * survive, so the crater floor sits ~18 mm above the board, ~12 mm below
 * the top face — a 15 mm fly standing in it is still in view.
 */
export const CURD_BITE_MM = { anchorFracX: 0.55, anchorFracZ: -0.6, radiusXz: 26, depth: 18 };

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

/** World Y of the oak table top (live standing surface). */
export function tableTopY(): number {
  return 0;
}

/** World Y of the cutting-board top (table top is y = 0). Live scene no longer mounts the board. */
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
 * Labellum midpoint in root space, Flybody native units, MEASURED by forward
 * kinematics on `anchors.json` (see tests/body/feedingMotion.test.ts — the
 * test fails if these drift from the rig). `y` is below the root, `z` ahead.
 *
 * Rest = idle clip with the authored resting fold (rostrum +30°, haustellum
 * +40°). Extended = end of the `per` clip (rostrum −35°, haustellum −60°).
 * The whole rostrum→labellum chain is ~1.6 mm at 6×, so PER adds only ~1.8 mm
 * of forward reach. The earlier kit assumed the extended tip reached
 * `standoff` (11.25 mm) — a declaration, not a measurement — which is why the
 * side-feeding proboscis ended in the board instead of the twaróg wall.
 */
export const REST_TIP_NATIVE = { y: -0.0462, z: 0.0553 } as const;
export const EXTENDED_TIP_NATIVE = { y: -0.0604, z: 0.0905 } as const;

/** Kept for callers that only need the rest z. */
export const LABELLUM_REST_Z_NATIVE = REST_TIP_NATIVE.z;

/** Rest labellum anterior of the root, millimetres at render scale. */
export function labellumRestReachAt(scale: number): number {
  return REST_TIP_NATIVE.z * flyRootScaleAt(scale);
}

export function labellumRestReachMm(): number {
  return labellumRestReachAt(FLY_RENDER_SCALE);
}

/** Extended labellum anterior of the root (≈ 4.5 mm at 6×). Measured, see above. */
export function extendedLabellumReachAt(scale: number): number {
  return EXTENDED_TIP_NATIVE.z * flyRootScaleAt(scale);
}

export function extendedLabellumReachMm(): number {
  return extendedLabellumReachAt(FLY_RENDER_SCALE);
}

/** Extended labellum below the root (≈ 3.0 mm at 6×). */
export function extendedLabellumDropAt(scale: number): number {
  return -EXTENDED_TIP_NATIVE.y * flyRootScaleAt(scale);
}

export function extendedLabellumDropMm(): number {
  return extendedLabellumDropAt(FLY_RENDER_SCALE);
}

/** How much PER adds beyond the resting reach (≈ 1.8 mm at 6×). */
export function proboscisReachAt(scale: number): number {
  return extendedLabellumReachAt(scale) - labellumRestReachAt(scale);
}

export function proboscisReachMm(): number {
  return proboscisReachAt(FLY_RENDER_SCALE);
}

/**
 * Side-feeding posture (authored): body pitched nose-up at a vertical food
 * face so the short proboscis meets the wall. 32° stays inside the 35° up-cone
 * (`UP_ALIGN_MAX_RAD`) so the surface-normal slerp does not fight it.
 */
export const WALL_FEED_PITCH_RAD = (32 * Math.PI) / 180;
/** How far the labellum tip may sink into the wall so it reads as contact. */
export const WALL_FEED_BITE_MM = 0.4;

/**
 * Extended labellum after pitching the body nose-up by `pitch` about the
 * root, in root-space millimetres: `z` forward, `y` up.
 */
export function pitchedTipAt(scale: number, pitch: number): { y: number; z: number } {
  const y = EXTENDED_TIP_NATIVE.y * flyRootScaleAt(scale);
  const z = EXTENDED_TIP_NATIVE.z * flyRootScaleAt(scale);
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  return { y: y * c + z * s, z: z * c - y * s };
}

/**
 * Root-to-wall distance at which the pitched labellum sinks `WALL_FEED_BITE_MM`
 * into a vertical food face (≈ 5.0 mm at 6×). This IS the approach standoff:
 * APPROACH ends where feeding can actually touch the food.
 */
export function wallFeedStandoffAt(scale: number): number {
  return pitchedTipAt(scale, WALL_FEED_PITCH_RAD).z - WALL_FEED_BITE_MM;
}

export function standoffAt(scale: number): number {
  return wallFeedStandoffAt(scale);
}

export function standoffMm(): number {
  return standoffAt(FLY_RENDER_SCALE);
}

/** Padding used when clamping the root so the body mesh stays outside solids (flight, pouch, orbit). */
export function bodyCollisionPadAt(scale: number): number {
  return flyVisualLengthAt(scale) / 2;
}

export function bodyCollisionPadMm(): number {
  return bodyCollisionPadAt(FLY_RENDER_SCALE);
}

/**
 * Padding for the FOOD root clamp only. Smaller than the body pad because the
 * pitched wall-feeding body leans over the wall edge; must stay below the
 * standoff or APPROACH could never arrive.
 */
export function foodStandPadAt(scale: number): number {
  return Math.max(1, standoffAt(scale) - 0.5);
}

export function foodStandPadMm(): number {
  return foodStandPadAt(FLY_RENDER_SCALE);
}

/** Crumb particle size, scaled with the fly (0.08 visual body lengths). */
export function crumbSizeMm(): number {
  return flyVisualLengthMm() * 0.08;
}

export function tubRadiusMm(): number {
  return mm(TUB_MM.diameter) / 2;
}

export function tubInnerRadiusMm(): number {
  return tubRadiusMm() - mm(TUB_MM.wall);
}

export const POUCH_INNER_MM = {
  length: POUCH_MM.length - 2 * SEAL_MM,
  width: POUCH_MM.width - 2 * SEAL_MM,
  height: POUCH_MM.height,
} as const;
