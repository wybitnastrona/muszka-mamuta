/**
 * Authored UV landmarks on the vacuum-pouch labels. The cow graphic and
 * nutrition-table rows are not measured; they are hard-coded in opaque-rect
 * UV and mapped into pouch-local millimetres with the same contain-fit used
 * by `setPackLabelUVs`.
 */
import { LABEL_IMAGE_H, LABEL_IMAGE_W, POUCH_BASE_HEIGHT_MM, POUCH_MM, SEAL_MM, mm } from './scale.ts';

export type Uv = { u: number; v: number };

/** Cow illustration on pack_front (opaque-rect UV). */
export const PACK_FRONT_COW_UV: Uv = { u: 0.5, v: 0.34 };
export const PACK_FRONT_LANDING_UV: Uv = { u: 0.28, v: 0.62 };

/** Nutrition-table row baselines on pack_back, last is protein. */
export const PACK_BACK_NUTRITION_ROWS: { id: string; uv: Uv }[] = [
  { id: 'energy', uv: { u: 0.58, v: 0.26 } },
  { id: 'fat', uv: { u: 0.58, v: 0.36 } },
  { id: 'carbs', uv: { u: 0.58, v: 0.46 } },
  { id: 'protein', uv: { u: 0.58, v: 0.56 } },
];

function containSpans(): { spanX: number; spanZ: number; faceL: number; faceW: number } {
  const faceL = mm(POUCH_MM.length);
  const faceW = mm(POUCH_MM.width);
  const margin = 0.93;
  const aspect = LABEL_IMAGE_W / LABEL_IMAGE_H;
  let spanX = faceL * margin;
  let spanZ = spanX * aspect;
  if (spanZ > faceW * margin) {
    spanZ = faceW * margin;
    spanX = spanZ / Math.max(1e-8, aspect);
  }
  return { spanX, spanZ, faceL, faceW };
}

/**
 * Opaque-rect UV → pouch-local millimetres. Matches the contain + 90° map
 * in `setPackLabelUVs` (`su = pv`, `sv = 1 - pu`).
 */
export function opaqueUvToPouchLocal(uv: Uv, y = mm(POUCH_BASE_HEIGHT_MM) + 1.2): { x: number; y: number; z: number } {
  const { spanX, spanZ } = containSpans();
  const pu = 1 - uv.v;
  const pv = uv.u;
  const x = (pu - 0.5) * spanX;
  const z = (0.5 - pv) * spanZ;
  return { x, y, z };
}

export function pouchLocalToWorld(
  local: { x: number; y: number; z: number },
  pouch: { x: number; y: number; z: number; yaw: number },
): { x: number; y: number; z: number } {
  const c = Math.cos(pouch.yaw);
  const s = Math.sin(pouch.yaw);
  return {
    x: pouch.x + local.x * c + local.z * s,
    y: pouch.y + local.y,
    z: pouch.z - local.x * s + local.z * c,
  };
}

export function pouchWorldFromUv(
  uv: Uv,
  pouch: { x: number; y: number; z: number; yaw: number },
): { x: number; y: number; z: number } {
  return pouchLocalToWorld(opaqueUvToPouchLocal(uv), pouch);
}

/** Crease used by the foil-slip gag: local +X toward the sealed end. */
export function pouchCreaseDir(pouchYaw: number): { x: number; z: number } {
  const c = Math.cos(pouchYaw);
  const s = Math.sin(pouchYaw);
  const lx = mm(SEAL_MM);
  const lz = mm(POUCH_MM.width) * 0.15;
  const len = Math.hypot(lx, lz) || 1;
  const nx = lx / len;
  const nz = lz / len;
  return { x: nx * c + nz * s, z: -nx * s + nz * c };
}
