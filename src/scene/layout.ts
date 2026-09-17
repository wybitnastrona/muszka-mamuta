import {
  BOARD_MM,
  BOARD_YAW_DEG,
  CURD_MM,
  LABEL_IMAGE_H,
  LABEL_IMAGE_W,
  POUCH_MM,
  POUCH_YAW_DEG,
  SEAL_MM,
  boardTopY,
  flyVisualLengthMm,
  mm,
} from './scale.ts';

const DEG = Math.PI / 180;
const TABLE_MARGIN_MM = 48;

export type KitchenLayout = {
  curd: { x: number; y: number; z: number };
  biteFront: { x: number; y: number; z: number };
  fly: { x: number; z: number };
  pouch: { x: number; y: number; z: number; yaw: number };
  table: { width: number; depth: number };
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

function tableSizeForBoard(yaw: number): { width: number; depth: number } {
  const hx = mm(BOARD_MM.length) / 2;
  const hz = mm(BOARD_MM.width) / 2;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return {
    width: Math.ceil((hx * c + hz * s) * 2 + TABLE_MARGIN_MM),
    depth: Math.ceil((hx * s + hz * c) * 2 + TABLE_MARGIN_MM),
  };
}

/**
 * Fly approaches from −Z (mesh +Z is anterior). Bite corner is the
 * anterior-left of the block ( +X, −Z ) — the corner toward the pouch.
 * Pouch sits to +X, slightly +Z of the curd, yawed 15°, open at local −X.
 * Empty film, plate, 250 g block and fly rest on the cutting board
 * (`board.topY`); the table top stays at y = 0.
 */
export function kitchenLayout(): KitchenLayout {
  const yaw = BOARD_YAW_DEG * DEG;
  const topY = boardTopY();
  const board = {
    x: 0,
    y: topY / 2,
    z: 0,
    yaw,
    hx: mm(BOARD_MM.length) / 2,
    hy: topY / 2,
    hz: mm(BOARD_MM.width) / 2,
    topY,
  };
  const hy = mm(CURD_MM.height) / 2;
  const curd = { x: 0, y: topY + hy, z: 0 };
  const biteFront = {
    x: mm(CURD_MM.width) / 2,
    y: topY + mm(CURD_MM.height) * 0.28,
    z: -mm(CURD_MM.length) / 2,
  };
  const fly = {
    x: biteFront.x - 6,
    z: biteFront.z - flyVisualLengthMm() * 0.9,
  };
  const pouchYaw = POUCH_YAW_DEG * DEG;
  const openLocalX = -mm(POUCH_MM.length) / 2;
  const openWorldX = mm(CURD_MM.width) / 2 + mm(SEAL_MM) + 6;
  const openWorldZ = 8;
  const pouch = {
    x: openWorldX - openLocalX * Math.cos(pouchYaw),
    y: topY + 1.2,
    z: openWorldZ - openLocalX * Math.sin(pouchYaw),
    yaw: pouchYaw,
  };
  return {
    curd,
    biteFront,
    fly,
    pouch,
    table: tableSizeForBoard(yaw),
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
 * World Y of the standing surface: chunk / intact hull top, else the board
 * top inside its footprint, else the table (0).
 */
export function supportHeightAt(x: number, z: number, foodHeight: number): number {
  if (foodHeight > 0) return foodHeight;
  return pointInBoardFootprint(x, z) ? boardTopY() : 0;
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
