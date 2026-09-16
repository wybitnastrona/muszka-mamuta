import type { EulerDeg, Quat } from './types.ts';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const IDENTITY: Quat = [0, 0, 0, 1];

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInOut(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** GLSL-style Hermite smoothstep. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x >= edge1 ? 1 : 0;
  return easeInOut((x - edge0) / (edge1 - edge0));
}

export function wrapPi(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function headingError(heading: number, target: number): number {
  return wrapPi(target - heading);
}

export function turnToward(heading: number, target: number, dt: number, rateRadS: number): number {
  const err = headingError(heading, target);
  const maxStep = Math.max(0, rateRadS) * Math.max(0, dt);
  if (Math.abs(err) <= maxStep) return wrapPi(target);
  return wrapPi(heading + Math.sign(err) * maxStep);
}

export function mulQuat(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function normalizeQuat(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n < 1e-12) return IDENTITY;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Intrinsic XYZ Euler in degrees → quaternion, matching THREE.Euler('XYZ'). */
export function eulerDegToQuat(euler: EulerDeg): Quat {
  const hx = (euler[0] * DEG) / 2;
  const hy = (euler[1] * DEG) / 2;
  const hz = (euler[2] * DEG) / 2;
  const qx: Quat = [Math.sin(hx), 0, 0, Math.cos(hx)];
  const qy: Quat = [0, Math.sin(hy), 0, Math.cos(hy)];
  const qz: Quat = [0, 0, Math.sin(hz), Math.cos(hz)];
  return normalizeQuat(mulQuat(mulQuat(qz, qy), qx));
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  const x = clamp01(t);
  let ax = a[0], ay = a[1], az = a[2], aw = a[3];
  let dot = ax * b[0] + ay * b[1] + az * b[2] + aw * b[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (dot > 0.9995) {
    return normalizeQuat([
      lerp(ax, bx, x),
      lerp(ay, by, x),
      lerp(az, bz, x),
      lerp(aw, bw, x),
    ]);
  }
  const th = Math.acos(clamp(dot, -1, 1));
  const s = Math.sin(th);
  const wa = Math.sin((1 - x) * th) / s;
  const wb = Math.sin(x * th) / s;
  return normalizeQuat([
    wa * ax + wb * bx,
    wa * ay + wb * by,
    wa * az + wb * bz,
    wa * aw + wb * bw,
  ]);
}

/** Value-noise hash in [-1, 1]. */
export function hashNoise(x: number, seed: number): number {
  const s = Math.sin(x * 127.1 + seed * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Smooth 1D noise in [-1, 1]. */
export function perlin1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hashNoise(i, seed), hashNoise(i + 1, seed), u);
}
