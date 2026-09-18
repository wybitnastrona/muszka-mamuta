import { Xoshiro128ss } from '../brain/rng.ts';
import {
  BENCH_MM,
  DUMBBELL_MM,
  LABEL_IMAGE_H,
  LABEL_IMAGE_W,
  MAT_MM,
  MILL_MM,
  PILE_MM,
  POUCH_MM,
  TUB_MM,
  flyVisualLengthMm,
  mm,
  tableTopY,
  tubInnerRadiusMm,
  tubRadiusMm,
  bodyCollisionPadMm,
} from './scale.ts';

const DEG = Math.PI / 180;
const TABLE_MARGIN_MM = 48;

export type KitchenLayout = {
  /** Powder fill centre inside the tub well (also aliased as `curd`). */
  pile: { x: number; y: number; z: number };
  /** @deprecated Use `pile`. Same object. */
  curd: { x: number; y: number; z: number };
  biteFront: { x: number; y: number; z: number };
  fly: { x: number; z: number };
  scoop: { x: number; y: number; z: number; yaw: number };
  mill: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    hx: number;
    hy: number;
    hz: number;
    deckY: number;
  };
  tub: {
    x: number;
    y: number;
    z: number;
    diameter: number;
    height: number;
    innerRadius: number;
    yaw: number;
  };
  /**
   * @deprecated Same pose as `tub`. Kept for older callers.
   */
  tubSlot: { x: number; y: number; z: number; diameter: number; height: number };
  /**
   * Collision / gag OBB. Live scene: the mill (pouch mesh is not mounted).
   */
  pouch: { x: number; y: number; z: number; yaw: number };
  table: { width: number; depth: number };
  /** Table working footprint. `topY` is the oak slab (0), not the unused board. */
  board: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    hx: number;
    hy: number;
    hz: number;
    topY: number;
  };
  /** Rubber mat beside the mill (+Z). Walkable support, not a collision solid. */
  mat: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    hx: number;
    hy: number;
    hz: number;
    topY: number;
  };
  /** Padded bench beside the dumbbell stack. Collision OBB. */
  bench: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    hx: number;
    hy: number;
    hz: number;
    topY: number;
  };
  /**
   * Four dumbbells (3+1 pyramid) on the mat. Each is a collision OBB.
   * `length` is the authored bar+plates span passed to createDumbbell.
   */
  dumbbells: Array<{
    x: number;
    y: number;
    z: number;
    yaw: number;
    hx: number;
    hy: number;
    hz: number;
    length: number;
  }>;
};

/** Tub axis on −X; mill on +X with a gap past the Ø110 rim. */
const TUB_X_MM = -90;
/** Clear air from the tub outer rim to the mill −X face. */
export const MILL_GAP_MM = 28;

export function millCentreX(): number {
  return TUB_X_MM + tubRadiusMm() + MILL_GAP_MM + mm(MILL_MM.length) / 2;
}

/** Clear air from the mill +Z face to the mat −Z face. */
export const GYM_GAP_MM = 12;
/** Bench long-edge yaw vs the mill frame. */
export const BENCH_YAW_RAD = (15 * Math.PI) / 180;
const GYM_DUMBBELL_SEED = 0x47594d31;

export function yawedAabbHalf(hx: number, hz: number, yaw: number): { aabbHx: number; aabbHz: number } {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return { aabbHx: hx * c + hz * s, aabbHz: hx * s + hz * c };
}

function gymMatPose(): KitchenLayout['mat'] {
  const millHx = mm(MILL_MM.length) / 2;
  const millHz = mm(MILL_MM.width) / 2;
  const hx = mm(MAT_MM.length) / 2;
  const hz = mm(MAT_MM.width) / 2;
  const hy = mm(MAT_MM.thickness) / 2;
  return {
    x: millCentreX() + millHx + GYM_GAP_MM + hx,
    y: tableTopY() + hy,
    z: millHz + GYM_GAP_MM + hz,
    yaw: 0,
    hx,
    hy,
    hz,
    topY: tableTopY() + mm(MAT_MM.thickness),
  };
}

function gymBenchPose(): KitchenLayout['bench'] {
  const mat = gymMatPose();
  const hx = mm(BENCH_MM.length) / 2;
  const hz = mm(BENCH_MM.width) / 2;
  const hy = mm(BENCH_MM.height) / 2;
  const yaw = BENCH_YAW_RAD;
  const { aabbHx } = yawedAabbHalf(hx, hz, yaw);
  return {
    x: mat.x + mat.hx + GYM_GAP_MM + aabbHx,
    y: tableTopY() + hy,
    z: mat.z,
    yaw,
    hx,
    hy,
    hz,
    topY: tableTopY() + mm(BENCH_MM.height),
  };
}

function gymDumbbellPoses(): KitchenLayout['dumbbells'] {
  const mat = gymMatPose();
  const length = mm(DUMBBELL_MM.length);
  const r = mm(DUMBBELL_MM.plateRadius);
  const spacing = r * 2 + 0.8;
  const rng = new Xoshiro128ss(GYM_DUMBBELL_SEED);
  const yawOf = () => (rng.nextFloat() - 0.5) * 0.18;
  const bottomZ = [-spacing, 0, spacing];
  const bottom: KitchenLayout['dumbbells'] = bottomZ.map((dz) => ({
    x: mat.x,
    y: tableTopY() + mm(MAT_MM.thickness) + r,
    z: mat.z + dz,
    yaw: yawOf(),
    hx: length / 2,
    hy: r,
    hz: r,
    length,
  }));
  const nest = spacing / 2;
  const topY = tableTopY() + mm(MAT_MM.thickness) + r + Math.sqrt(Math.max(0, (2 * r) ** 2 - nest ** 2));
  const top = {
    x: mat.x,
    y: topY,
    z: mat.z + nest,
    yaw: yawOf(),
    hx: length / 2,
    hy: r,
    hz: r,
    length,
  };
  return [...bottom, top];
}

function tableSizeForProps(): { width: number; depth: number } {
  const tubR = tubRadiusMm();
  const millHx = mm(MILL_MM.length) / 2;
  const millHz = mm(MILL_MM.width) / 2;
  const millX = millCentreX();
  const mat = gymMatPose();
  const bench = gymBenchPose();
  const benchAabb = yawedAabbHalf(bench.hx, bench.hz, bench.yaw);
  const spanX = Math.max(
    Math.abs(TUB_X_MM) + tubR,
    millX + millHx,
    Math.abs(mat.x) + mat.hx,
    Math.abs(bench.x) + benchAabb.aabbHx,
  );
  const spanZ = Math.max(
    tubR,
    millHz,
    Math.abs(mat.z) + mat.hz,
    Math.abs(bench.z) + benchAabb.aabbHz,
  ) + 48;
  return {
    width: Math.ceil(spanX * 2 + TABLE_MARGIN_MM),
    depth: Math.ceil(spanZ * 2 + TABLE_MARGIN_MM),
  };
}

/**
 * Lab table: open KFD tub (−X) with powder in the well, scoop, mill (+X).
 * No cutting board, no PET pouch. Table top is y = 0.
 */
export function kitchenLayout(): KitchenLayout {
  const topY = tableTopY();
  const table = tableSizeForProps();
  const board = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    hx: table.width / 2,
    hy: 0.5,
    hz: table.depth / 2,
    topY,
  };
  const tubR = tubRadiusMm();
  const tubH = mm(TUB_MM.height);
  const tub = {
    x: TUB_X_MM,
    y: topY + tubH / 2,
    z: 0,
    diameter: mm(TUB_MM.diameter),
    height: tubH,
    innerRadius: tubInnerRadiusMm(),
    // Cylinder u=0.5 is local −Z; yaw −π/2 aims that front at the mill (+X).
    yaw: -Math.PI / 2,
  };
  const hy = mm(PILE_MM.height) / 2;
  const pile = { x: tub.x, y: topY + mm(TUB_MM.wall) + hy, z: tub.z };
  const biteFront = {
    x: pile.x,
    y: topY + mm(TUB_MM.wall) + mm(PILE_MM.height) * 0.85,
    z: pile.z - tubR,
  };
  const scoop = {
    x: tub.x,
    y: topY + mm(TUB_MM.wall) + mm(PILE_MM.height),
    z: tub.z,
    yaw: 0.2,
  };
  const millHy = mm(MILL_MM.height) / 2;
  const mill = {
    x: millCentreX(),
    y: topY + millHy,
    z: 0,
    yaw: 0,
    hx: mm(MILL_MM.length) / 2,
    hy: millHy,
    hz: mm(MILL_MM.width) / 2,
    deckY: topY + mm(MILL_MM.deck),
  };
  const mat = gymMatPose();
  const bench = gymBenchPose();
  const dumbbells = gymDumbbellPoses();
  const fly = {
    x: tub.x,
    z: tub.z - tubR - flyVisualLengthMm() * 1.4,
  };
  const pouch = {
    x: mill.x,
    y: mill.deckY,
    z: mill.z,
    yaw: mill.yaw,
  };
  const tubSlot = {
    x: tub.x,
    y: topY,
    z: tub.z,
    diameter: tub.diameter,
    height: tub.height,
  };
  return {
    pile,
    curd: pile,
    biteFront,
    fly,
    scoop,
    mill,
    tub,
    tubSlot,
    pouch,
    table,
    board,
    mat,
    bench,
    dumbbells,
  };
}

/** Board-local XZ (length along +X, width along +Z) from world XZ. */
export function worldToBoardLocal(x: number, z: number): { x: number; z: number } {
  const b = kitchenLayout().board;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const dx = x - b.x;
  const dz = z - b.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

export function boardLocalToWorld(lx: number, lz: number): { x: number; z: number } {
  const b = kitchenLayout().board;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return {
    x: b.x + lx * c + lz * s,
    z: b.z - lx * s + lz * c,
  };
}

export function pointInBoardFootprint(x: number, z: number, pad = 0): boolean {
  const b = kitchenLayout().board;
  const local = worldToBoardLocal(x, z);
  return Math.abs(local.x) <= b.hx + pad && Math.abs(local.z) <= b.hz + pad;
}

/**
 * World Y of the standing surface: pile top, else the table (0).
 */
export function supportHeightAt(x: number, z: number, foodHeight: number): number {
  if (foodHeight > 0) return foodHeight;
  return pointInBoardFootprint(x, z) ? tableTopY() : 0;
}

/**
 * Eat / pump stand: inside the open well on the powder stack, offset a few
 * millimetres toward the mill so the fly is not on the exact axis.
 */
export function scoopEatStand(): { x: number; z: number; heading: number } {
  const tub = kitchenLayout().tub;
  return {
    x: tub.x + 8,
    z: tub.z,
    heading: Math.PI / 2,
  };
}

/** Pad beyond the collision hull, authored for the reel (not a measured standoff). */
const SCOOP_TABLE_PAD_MM = 8;

/**
 * Eat / drop stand on the table beside the tub, kitchen-camera side (−Z).
 * Heading 0 faces +Z, toward the tub axis.
 */
export function scoopTableStand(): { x: number; z: number; heading: number } {
  const tub = kitchenLayout().tub;
  const clearance = tubRadiusMm() + bodyCollisionPadMm() + SCOOP_TABLE_PAD_MM;
  return {
    x: tub.x,
    z: tub.z - clearance,
    heading: 0,
  };
}

/** Distance from the tub wall to `scoopTableStand` (axis distance − outer radius). */
export function scoopTableClearanceMm(): number {
  return bodyCollisionPadMm() + SCOOP_TABLE_PAD_MM;
}

/**
 * Label plane size in mm. Photograph U follows pouch +X, V follows pouch +Z
 * (no wrap, no extra 90°). `photoWidthOverHeight` is the opaque-region aspect
 * (defaults to the 1024×2048 file). Fitted to the 130×110 mm top face.
 */
export function labelPlaneSize(
  photoWidthOverHeight = LABEL_IMAGE_W / LABEL_IMAGE_H,
): { length: number; width: number } {
  const faceLength = mm(POUCH_MM.length);
  const faceWidth = mm(POUCH_MM.width);
  const margin = 0.92;
  let width = faceWidth * margin;
  let length = width * photoWidthOverHeight;
  if (length > faceLength * margin) {
    length = faceLength * margin;
    width = length / photoWidthOverHeight;
  }
  return { length, width };
}

export function pointInGymMat(x: number, z: number): boolean {
  const m = kitchenLayout().mat;
  const dx = x - m.x;
  const dz = z - m.z;
  const c = Math.cos(m.yaw);
  const s = Math.sin(m.yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= m.hx && Math.abs(lz) <= m.hz;
}

export function gymMatTopY(): number {
  return kitchenLayout().mat.topY;
}

export function gymClearancesMm(): {
  millToMatZ: number;
  millToMatX: number;
  tubRimToMat: number;
  matToBenchX: number;
  millToBench: number;
} {
  const { tub, mill, mat, bench } = kitchenLayout();
  const millToMatZ = (mat.z - mat.hz) - (mill.z + mill.hz);
  const millToMatX = (mat.x - mat.hx) - (mill.x + mill.hx);
  const closestX = Math.min(Math.max(tub.x, mat.x - mat.hx), mat.x + mat.hx);
  const closestZ = Math.min(Math.max(tub.z, mat.z - mat.hz), mat.z + mat.hz);
  const tubRimToMat = Math.hypot(closestX - tub.x, closestZ - tub.z) - tub.diameter / 2;
  const benchAabb = yawedAabbHalf(bench.hx, bench.hz, bench.yaw);
  const matToBenchX = (bench.x - benchAabb.aabbHx) - (mat.x + mat.hx);
  const millMaxX = mill.x + mill.hx;
  const millMinX = mill.x - mill.hx;
  const millMaxZ = mill.z + mill.hz;
  const millMinZ = mill.z - mill.hz;
  const bMinX = bench.x - benchAabb.aabbHx;
  const bMaxX = bench.x + benchAabb.aabbHx;
  const bMinZ = bench.z - benchAabb.aabbHz;
  const bMaxZ = bench.z + benchAabb.aabbHz;
  const sepX = millMaxX < bMinX ? bMinX - millMaxX : bMaxX < millMinX ? millMinX - bMaxX : 0;
  const sepZ = millMaxZ < bMinZ ? bMinZ - millMaxZ : bMaxZ < millMinZ ? millMinZ - bMaxZ : 0;
  const millToBench = Math.hypot(sepX, sepZ);
  return { millToMatZ, millToMatX, tubRimToMat, matToBenchX, millToBench };
}

void DEG;
