/**
 * Authored 3D exclusion and orientation clamps. Not rigid-body physics.
 * The fly's centre must never enter the twaróg AABB, the pouch OBB or the
 * board volume, in any locomotion mode. Bottom-face exits are forbidden so
 * she cannot be pushed underneath a solid.
 */
import { clamp, lerp } from './math.ts';

export type Vec3 = { x: number; y: number; z: number };

export type Aabb3 = {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
};

export type Obb3 = Aabb3 & { yaw: number };

export const FLIGHT_CEILING_MM = 220;
export const LOOKAHEAD_S = 0.2;
export const UP_ALIGN_MAX_RAD = (35 * Math.PI) / 180;
export const UP_ALIGN_TAU_S = 0.15;
const EPS = 1e-3;

export function pointInAabb3(p: Vec3, b: Aabb3, pad = 0): boolean {
  return (
    Math.abs(p.x - b.cx) <= b.hx + pad
    && Math.abs(p.y - b.cy) <= b.hy + pad
    && Math.abs(p.z - b.cz) <= b.hz + pad
  );
}

type Face = { nx: number; ny: number; nz: number; dist: number };

export type Normal3 = { nx: number; ny: number; nz: number };

/**
 * Face-choice hysteresis. Near an edge two faces are almost equidistant and
 * the nearest one flips every frame, which reads as sliding along the edge.
 * A face matching the previous frame's normal wins unless another face is
 * more than 25% closer.
 */
export const FACE_HYSTERESIS = 0.75;

function insideFaces(p: Vec3, b: Aabb3, pad: number): Face[] {
  const hx = b.hx + pad;
  const hy = b.hy + pad;
  const hz = b.hz + pad;
  const dx = p.x - b.cx;
  const dy = p.y - b.cy;
  const dz = p.z - b.cz;
  return [
    { nx: 1, ny: 0, nz: 0, dist: hx - dx },
    { nx: -1, ny: 0, nz: 0, dist: hx + dx },
    { nx: 0, ny: 1, nz: 0, dist: hy - dy },
    { nx: 0, ny: -1, nz: 0, dist: hy + dy },
    { nx: 0, ny: 0, nz: 1, dist: hz - dz },
    { nx: 0, ny: 0, nz: -1, dist: hz + dz },
  ];
}

/**
 * Push out along the nearest face that is not the bottom. Sliding the
 * velocity removes the inward component so the hit reads as a glance, not glass.
 */
export function resolveAabb3(
  p: Vec3,
  v: Vec3,
  b: Aabb3,
  pad = 0,
  prefer: Normal3 | null = null,
): { position: Vec3; velocity: Vec3; hit: boolean; nx: number; ny: number; nz: number } {
  if (!pointInAabb3(p, b, pad)) {
    return { position: { ...p }, velocity: { ...v }, hit: false, nx: 0, ny: 0, nz: 0 };
  }
  const faces = insideFaces(p, b, pad).filter((f) => f.ny >= 0);
  const score = (f: Face) => {
    const same = prefer && f.nx === prefer.nx && f.ny === prefer.ny && f.nz === prefer.nz;
    return same ? f.dist * FACE_HYSTERESIS : f.dist;
  };
  let best = faces[0]!;
  for (const f of faces) {
    if (score(f) < score(best)) best = f;
  }
  const position = {
    x: p.x + best.nx * (best.dist + EPS),
    y: p.y + best.ny * (best.dist + EPS),
    z: p.z + best.nz * (best.dist + EPS),
  };
  const vn = v.x * best.nx + v.y * best.ny + v.z * best.nz;
  const velocity = vn < 0
    ? { x: v.x - best.nx * vn, y: v.y - best.ny * vn, z: v.z - best.nz * vn }
    : { ...v };
  return { position, velocity, hit: true, nx: best.nx, ny: best.ny, nz: best.nz };
}

function toLocalObb(p: Vec3, obb: Obb3): Vec3 {
  const c = Math.cos(obb.yaw);
  const s = Math.sin(obb.yaw);
  const dx = p.x - obb.cx;
  const dz = p.z - obb.cz;
  return { x: dx * c - dz * s, y: p.y - obb.cy, z: dx * s + dz * c };
}

function fromLocalObb(local: Vec3, obb: Obb3): Vec3 {
  const c = Math.cos(obb.yaw);
  const s = Math.sin(obb.yaw);
  return {
    x: obb.cx + local.x * c + local.z * s,
    y: obb.cy + local.y,
    z: obb.cz - local.x * s + local.z * c,
  };
}

function toLocalDir(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c };
}

function fromLocalObbDir(local: Vec3, obb: Obb3): Vec3 {
  const c = Math.cos(obb.yaw);
  const s = Math.sin(obb.yaw);
  return {
    x: local.x * c + local.z * s,
    y: local.y,
    z: -local.x * s + local.z * c,
  };
}

export function pointInObb3(p: Vec3, obb: Obb3, pad = 0): boolean {
  const local = toLocalObb(p, obb);
  return pointInAabb3(local, { cx: 0, cy: 0, cz: 0, hx: obb.hx, hy: obb.hy, hz: obb.hz }, pad);
}

export function resolveObb3(
  p: Vec3,
  v: Vec3,
  obb: Obb3,
  pad = 0,
  prefer: Normal3 | null = null,
): { position: Vec3; velocity: Vec3; hit: boolean; nx: number; ny: number; nz: number } {
  const box: Aabb3 = { cx: 0, cy: 0, cz: 0, hx: obb.hx, hy: obb.hy, hz: obb.hz };
  const localP = toLocalObb(p, obb);
  const localV = toLocalDir(v, obb.yaw);
  let localPrefer: Normal3 | null = null;
  if (prefer) {
    const l = toLocalDir({ x: prefer.nx, y: prefer.ny, z: prefer.nz }, obb.yaw);
    // Snap to the dominant local axis so the equality test in resolveAabb3 can match.
    const ax = Math.abs(l.x);
    const ay = Math.abs(l.y);
    const az = Math.abs(l.z);
    if (ax >= ay && ax >= az) localPrefer = { nx: Math.sign(l.x), ny: 0, nz: 0 };
    else if (ay >= az) localPrefer = { nx: 0, ny: Math.sign(l.y), nz: 0 };
    else localPrefer = { nx: 0, ny: 0, nz: Math.sign(l.z) };
  }
  const out = resolveAabb3(localP, localV, box, pad, localPrefer);
  const n = fromLocalObbDir({ x: out.nx, y: out.ny, z: out.nz }, obb);
  return {
    position: fromLocalObb(out.position, obb),
    velocity: fromLocalObbDir(out.velocity, obb),
    hit: out.hit,
    nx: n.x,
    ny: n.y,
    nz: n.z,
  };
}

export function resolveSolids(
  p: Vec3,
  v: Vec3,
  aabbs: readonly Aabb3[],
  obbs: readonly Obb3[] = [],
  pad = 0,
  prefer: Normal3 | null = null,
): { position: Vec3; velocity: Vec3; hit: boolean; normal: Normal3 | null } {
  let position = { ...p };
  let velocity = { ...v };
  let hit = false;
  let normal: Normal3 | null = null;
  for (let i = 0; i < 4; i++) {
    let moved = false;
    for (const box of aabbs) {
      const out = resolveAabb3(position, velocity, box, pad, prefer);
      position = out.position;
      velocity = out.velocity;
      if (out.hit) {
        hit = true;
        moved = true;
        normal = { nx: out.nx, ny: out.ny, nz: out.nz };
      }
    }
    for (const obb of obbs) {
      const out = resolveObb3(position, velocity, obb, pad, prefer);
      position = out.position;
      velocity = out.velocity;
      if (out.hit) {
        hit = true;
        moved = true;
        normal = { nx: out.nx, ny: out.ny, nz: out.nz };
      }
    }
    if (!moved) break;
  }
  return { position, velocity, hit, normal };
}

/**
 * Smallest orbit radius that keeps the fly centre clear of a box's corners.
 * The old constant (60 mm) sat inside the twaróg's 64 mm XZ diagonal, so the
 * orbit was resolved onto a side face every frame — "flying along the edge".
 */
export function orbitRadiusFloor(box: Aabb3, pad: number, clearance: number): number {
  return Math.hypot(box.hx, box.hz) + Math.max(0, pad) + Math.max(0, clearance);
}

/** Axis-aligned hull of a yawed box — used for 200 ms flight lookahead. */
export function obbAabbHull(obb: Obb3): Aabb3 {
  const c = Math.abs(Math.cos(obb.yaw));
  const s = Math.abs(Math.sin(obb.yaw));
  return {
    cx: obb.cx,
    cy: obb.cy,
    cz: obb.cz,
    hx: obb.hx * c + obb.hz * s,
    hy: obb.hy,
    hz: obb.hx * s + obb.hz * c,
  };
}

export function segmentHitsObb3(a: Vec3, b: Vec3, obb: Obb3, pad = 0): boolean {
  return segmentHitsAabb3(
    toLocalObb(a, obb),
    toLocalObb(b, obb),
    { cx: 0, cy: 0, cz: 0, hx: obb.hx, hy: obb.hy, hz: obb.hz },
    pad,
  );
}

/** Slab test: true if the open segment (a→b) passes through the interior. */
export function segmentHitsAabb3(a: Vec3, b: Vec3, box: Aabb3, pad = 0): boolean {
  const hx = box.hx + pad;
  const hy = box.hy + pad;
  const hz = box.hz + pad;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  let tmin = 0;
  let tmax = 1;
  const slabs: [number, number, number][] = [
    [a.x - box.cx, dx, hx],
    [a.y - box.cy, dy, hy],
    [a.z - box.cz, dz, hz],
  ];
  for (const [o, d, h] of slabs) {
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(o) > h) return false;
      continue;
    }
    const inv = 1 / d;
    let t0 = (-h - o) * inv;
    let t1 = (h - o) * inv;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return false;
  }
  return tmax >= 0 && tmin <= 1 && tmax - tmin > 1e-6;
}

export function xzInsideAabb(x: number, z: number, b: Aabb3, pad = 0): boolean {
  return Math.abs(x - b.cx) <= b.hx + pad && Math.abs(z - b.cz) <= b.hz + pad;
}

export function aabbTopY(b: Aabb3): number {
  return b.cy + b.hy;
}

/**
 * Land on the top face or beside a vertical wall — never under a solid.
 * Target Y is at least `supportY`. XZ inside a footprint below its top is
 * snapped up to the top (if support is the top) or pushed to the nearest side.
 */
export function clampLandTarget(target: Vec3, supportY: number, obstacles: readonly Aabb3[]): Vec3 {
  let x = target.x;
  let y = Math.max(target.y, supportY);
  let z = target.z;
  for (const box of obstacles) {
    if (!xzInsideAabb(x, z, box)) continue;
    const top = aabbTopY(box);
    if (y + EPS >= top) continue;
    const toTop = top - y;
    const toPosX = box.cx + box.hx - x;
    const toNegX = x - (box.cx - box.hx);
    const toPosZ = box.cz + box.hz - z;
    const toNegZ = z - (box.cz - box.hz);
    const toSide = Math.min(toPosX, toNegX, toPosZ, toNegZ);
    if (supportY + EPS >= top || toTop <= toSide) {
      y = Math.max(y, top);
    } else if (toSide === toPosX) {
      x = box.cx + box.hx + EPS;
    } else if (toSide === toNegX) {
      x = box.cx - box.hx - EPS;
    } else if (toSide === toPosZ) {
      z = box.cz + box.hz + EPS;
    } else {
      z = box.cz - box.hz - EPS;
    }
  }
  return { x, y: Math.max(y, supportY), z };
}

export function quatFromEulerYxz(pitch: number, yaw: number, roll: number): [number, number, number, number] {
  const c1 = Math.cos(pitch / 2);
  const s1 = Math.sin(pitch / 2);
  const c2 = Math.cos(yaw / 2);
  const s2 = Math.sin(yaw / 2);
  const c3 = Math.cos(roll / 2);
  const s3 = Math.sin(roll / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
}

export function rotateByQuat(q: readonly [number, number, number, number], v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  return {
    x: v.x + qw * tx + (qy * tz - qz * ty),
    y: v.y + qw * ty + (qz * tx - qx * tz),
    z: v.z + qw * tz + (qx * ty - qy * tx),
  };
}

/** World-space body +Y for the director Euler (THREE 'YXZ': pitch, heading, roll). */
export function bodyUpAxis(pitch: number, heading: number, roll: number): Vec3 {
  return rotateByQuat(quatFromEulerYxz(pitch, heading, roll), { x: 0, y: 1, z: 0 });
}

export function tiltFromNormal(up: Vec3, normal: Vec3): number {
  const un = Math.hypot(up.x, up.y, up.z) || 1;
  const nn = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const dot = clamp((up.x * normal.x + up.y * normal.y + up.z * normal.z) / (un * nn), -1, 1);
  return Math.acos(dot);
}

function poseForNormal(normal: Vec3): { pitch: number; roll: number } {
  const nn = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const ny = normal.y / nn;
  if (ny > 0.7) return { pitch: 0, roll: 0 };
  return { pitch: Math.acos(clamp(ny, -1, 1)), roll: 0 };
}

/** Slerp pitch/roll toward the 35° cone around `normal` over ~150 ms. */
export function slerpTowardUpCone(
  pitch: number,
  heading: number,
  roll: number,
  normal: Vec3,
  dt: number,
): { pitch: number; roll: number } {
  const up = bodyUpAxis(pitch, heading, roll);
  if (tiltFromNormal(up, normal) <= UP_ALIGN_MAX_RAD) return { pitch, roll };
  const target = poseForNormal(normal);
  const a = 1 - Math.exp(-Math.max(0, dt) / UP_ALIGN_TAU_S);
  return { pitch: lerp(pitch, target.pitch, a), roll: lerp(roll, target.roll, a) };
}

export function loomingHit(
  from: Vec3,
  to: Vec3,
  obstacles: readonly Aabb3[],
  obbs: readonly Obb3[] = [],
): Aabb3 | Obb3 | null {
  for (const box of obstacles) {
    if (segmentHitsAabb3(from, to, box) || pointInAabb3(to, box)) return box;
  }
  for (const obb of obbs) {
    if (segmentHitsObb3(from, to, obb) || pointInObb3(to, obb)) return obb;
  }
  return null;
}

export function yawAwayFromBox(position: Vec3, box: { cx: number; cz: number }, heading: number): number {
  const away = Math.atan2(position.x - box.cx, position.z - box.cz);
  const err = Math.atan2(Math.sin(away - heading), Math.cos(away - heading));
  const dir = err >= 0 ? 1 : -1;
  return heading + dir * (Math.PI / 2);
}
