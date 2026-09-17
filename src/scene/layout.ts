import {
  LABEL_IMAGE_H,
  LABEL_IMAGE_W,
  MILL_MM,
  PILE_MM,
  POUCH_MM,
  TUB_MM,
  flyVisualLengthMm,
  mm,
  scoopEatClearanceMm,
  tableTopY,
  tubInnerRadiusMm,
  tubRadiusMm,
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
};

/** Tub axis on −X; mill on +X with a gap past the Ø110 rim. */
const TUB_X_MM = -90;
const MILL_GAP_MM = 28;

function millCentreX(): number {
  return TUB_X_MM + tubRadiusMm() + MILL_GAP_MM + mm(MILL_MM.length) / 2;
}

function tableSizeForProps(): { width: number; depth: number } {
  const tubR = tubRadiusMm();
  const millHx = mm(MILL_MM.length) / 2;
  const millHz = mm(MILL_MM.width) / 2;
  const millX = millCentreX();
  const spanX = Math.max(Math.abs(TUB_X_MM) + tubR, millX + millHx);
  const spanZ = Math.max(tubR, millHz) + 48;
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
 * Table pose for eating from the held scoop: south of the tub (−Z, camera
 * side), far enough that body and scoop miss the cylinder. Heading π faces
 * −Z (away from the wall), so the bowl does not aim at the jacket.
 */
export function scoopEatStand(): { x: number; z: number; heading: number } {
  const tub = kitchenLayout().tub;
  return {
    x: tub.x,
    z: tub.z - scoopEatClearanceMm(),
    heading: Math.PI,
  };
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

void DEG;
