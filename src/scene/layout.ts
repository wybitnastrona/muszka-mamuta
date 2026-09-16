import {
  CURD_MM,
  LABEL_IMAGE_H,
  LABEL_IMAGE_W,
  POUCH_MM,
  POUCH_YAW_DEG,
  SEAL_MM,
  flyVisualLengthMm,
  mm,
} from './scale.ts';

const DEG = Math.PI / 180;

export type KitchenLayout = {
  curd: { x: number; y: number; z: number };
  biteFront: { x: number; y: number; z: number };
  fly: { x: number; z: number };
  pouch: { x: number; y: number; z: number; yaw: number };
  table: { width: number; depth: number };
};

/**
 * Fly approaches from −Z (mesh +Z is anterior). Bite corner is the
 * anterior-left of the block ( +X, −Z ) — the corner toward the pouch.
 * Pouch sits to +X, slightly +Z of the curd, yawed 15°, open at local −X.
 * Empty film rests on the table (local Y ≈ 0); XZ offset and yaw are unchanged.
 */
export function kitchenLayout(): KitchenLayout {
  const curd = { x: 0, y: mm(CURD_MM.height) / 2, z: 0 };
  const biteFront = {
    x: mm(CURD_MM.width) / 2,
    y: mm(CURD_MM.height) * 0.28,
    z: -mm(CURD_MM.length) / 2,
  };
  const fly = {
    x: biteFront.x - 6,
    z: biteFront.z - flyVisualLengthMm() * 0.9,
  };
  const yaw = POUCH_YAW_DEG * DEG;
  const openLocalX = -mm(POUCH_MM.length) / 2;
  const openWorldX =  mm(CURD_MM.width) / 2 + mm(SEAL_MM) + 6;
  const openWorldZ = 8;
  const pouch = {
    x: openWorldX - openLocalX * Math.cos(yaw),
    y: 1.2,
    z: openWorldZ - openLocalX * Math.sin(yaw),
    yaw,
  };
  return {
    curd,
    biteFront,
    fly,
    pouch,
    table: { width: 420, depth: 340 },
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
