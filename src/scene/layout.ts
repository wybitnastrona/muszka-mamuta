import {
  LABEL_IMAGE_H,
  LABEL_IMAGE_W,
  MILL_MM,
  PILE_MM,
  POUCH_MM,
  TUB_MM,
  flyVisualLengthMm,
  mm,
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
  /** Lid off, on the table beside the open tub. */
  lid: { x: number; y: number; z: number; diameter: number; height: number; yaw: number };
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

function tableSizeForProps(): { width: number; depth: number } {
  const tubR = tubRadiusMm();
  const millHx = mm(MILL_MM.length) / 2;
  const millHz = mm(MILL_MM.width) / 2;
  const spanX = 85 + tubR + 8 + mm(TUB_MM.lidDiameter) + 75 + millHx;
  const spanZ = Math.max(tubR, millHz, mm(TUB_MM.lidDiameter) / 2) + 40;
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
    x: -85,
    y: topY + tubH / 2,
    z: 0,
    diameter: mm(TUB_MM.diameter),
    height: tubH,
    innerRadius: tubInnerRadiusMm(),
    yaw: 0,
  };
  const hy = mm(PILE_MM.height) / 2;
  const pile = { x: tub.x, y: topY + hy, z: tub.z };
  const biteFront = {
    x: pile.x,
    y: topY + mm(PILE_MM.height) * 0.85,
    z: pile.z - tubR,
  };
  const lidR = mm(TUB_MM.lidDiameter) / 2;
  const lidH = mm(TUB_MM.lidHeight);
  const lid = {
    x: tub.x - tubR - lidR - 8,
    y: topY + lidH / 2,
    z: 22,
    diameter: mm(TUB_MM.lidDiameter),
    height: lidH,
    yaw: 0.35,
  };
  const scoop = {
    x: tub.x + tubR + 14,
    y: topY + 0.6,
    z: 18,
    yaw: -0.4,
  };
  const millHy = mm(MILL_MM.height) / 2;
  const mill = {
    x: 75,
    y: topY + millHy,
    z: 0,
    yaw: 0,
    hx: mm(MILL_MM.length) / 2,
    hy: millHy,
    hz: mm(MILL_MM.width) / 2,
    deckY: topY + mm(MILL_MM.deck),
  };
  const fly = {
    x: scoop.x - 4,
    z: scoop.z - flyVisualLengthMm() * 1.1,
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
    lid,
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
