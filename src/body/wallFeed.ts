/**
 * Side-feeding posture (authored). When the fly eats from a VERTICAL face of
 * the twaróg while standing on the board (`mode === 'ground'`), her body
 * pitches nose-up, the root lifts so the hind feet stay on the board, and the
 * forelegs go up onto the food — so the short Flybody proboscis (measured
 * ~4.5 mm of reach at 6×, see scale.ts) actually meets the wall instead of
 * ending in the board.
 *
 * Behavioural basis: tarsal contact → proboscis extension toward the food
 * (Dethier 1976, The Hungry Fly). The 32° angle and the lift are authored for
 * the reel, not measurements. Top feeding (`onFood`) is unchanged.
 */
import { quatFromEulerYxz, rotateByQuat } from './collision.ts';
import { ANCHORS } from './hierarchy.ts';
import {
  FLY_RENDER_SCALE,
  WALL_FEED_PITCH_RAD,
  flyRootScaleAt,
  pitchedTipAt,
  wallFeedStandoffAt,
} from '../scene/scale.ts';

export { WALL_FEED_PITCH_RAD };

/** Pitch easing toward / away from the posture. */
export const WALL_FEED_TAU_S = 0.15;

/**
 * Director pitch is applied as THREE Euler 'YXZ' (pitch about X). Which sign
 * lifts the nose is a convention question, so derive it once from the same
 * quaternion helper the director uses instead of remembering it.
 */
export const NOSE_UP_SIGN: 1 | -1 = (() => {
  const fwd = rotateByQuat(quatFromEulerYxz(0.3, 0, 0), { x: 0, y: 0, z: 1 });
  return fwd.y > 0 ? 1 : -1;
})();

/** Signed director pitch for the wall-feeding posture. */
export function wallFeedPitch(): number {
  return NOSE_UP_SIGN * WALL_FEED_PITCH_RAD;
}

function anchor(name: string): readonly number[] {
  const b = ANCHORS.bones.find((x) => x.name === name);
  if (!b) throw new Error(`anchors.json has no ${name}`);
  return b.position;
}

/** Hind-foot z behind the root, millimetres at `scale`. */
export function hindFootOffsetAt(scale: number): number {
  return Math.abs(anchor('hindleg_L')[2]!) * flyRootScaleAt(scale);
}

/** Head front (bone z + maxRadius) ahead of the root, millimetres at `scale`. */
export function headFrontAt(scale: number): number {
  const b = ANCHORS.bones.find((x) => x.name === 'head')!;
  return (b.position[2]! + b.maxRadius) * flyRootScaleAt(scale);
}

/**
 * Root lift so the pitch reads as rotating about the hind feet rather than
 * the root (otherwise the abdomen dips into the board).
 */
export function wallFeedLiftAt(scale: number, pitch = WALL_FEED_PITCH_RAD): number {
  return hindFootOffsetAt(scale) * Math.sin(Math.abs(pitch));
}

export function wallFeedLiftMm(pitch = WALL_FEED_PITCH_RAD): number {
  return wallFeedLiftAt(FLY_RENDER_SCALE, pitch);
}

/** Labellum in root space after the posture pitch, millimetres (z forward, y up). */
export function wallFeedTipMm(pitch = WALL_FEED_PITCH_RAD): { y: number; z: number } {
  return pitchedTipAt(FLY_RENDER_SCALE, Math.abs(pitch));
}

export function wallFeedStandoffMm(): number {
  return wallFeedStandoffAt(FLY_RENDER_SCALE);
}

/** Head front after the pitch — must stay short of the standoff so the mesh clears the wall. */
export function pitchedHeadFrontAt(scale: number, pitch = WALL_FEED_PITCH_RAD): number {
  const head = ANCHORS.bones.find((x) => x.name === 'head')!;
  const z = (head.position[2]! + head.maxRadius) * flyRootScaleAt(scale);
  const y = head.position[1]! * flyRootScaleAt(scale);
  const p = Math.abs(pitch);
  return z * Math.cos(p) - y * Math.sin(p);
}

/**
 * Labellum tip for the kinematic-contact fallback (no rig): rest or extended
 * tip, rotated by the current director pitch, pushed along the heading.
 */
export function pitchedLabellumLocal(
  scale: number,
  pitch: number,
  extended: boolean,
  restTip: { y: number; z: number },
  extTip: { y: number; z: number },
): { y: number; z: number } {
  const t = extended ? extTip : restTip;
  const y = t.y * flyRootScaleAt(scale);
  const z = t.z * flyRootScaleAt(scale);
  const p = Math.abs(pitch);
  const c = Math.cos(p);
  const s = Math.sin(p);
  return { y: y * c + z * s, z: z * c - y * s };
}
