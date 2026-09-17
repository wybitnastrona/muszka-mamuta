/**
 * Authored flight kinematics. The connectome drives only the feeding gate
 * (gustatory channel → MN9). Saccades, orbit, landing and takeoff never write
 * into ActivityFrame or the brain worker.
 *
 * Parameters from:
 *   van Breugel & Dickinson 2012 — visual landing (expansion / τ, foreleg
 *     extension at ~60° angular size, 150° FOV virtual eye).
 *   Card & Dickinson 2008 — voluntary (type 1) vs escape (type 2) takeoff.
 * See docs/BODY-MODEL.md.
 */
import { Xoshiro128ss } from '../brain/rng.ts';
import { clamp, clamp01, headingError, lerp, perlin1, wrapPi } from './math.ts';
import { BLUR_LAND_FADE_S, WING_FLICKER_DEG, WING_FLICKER_HZ } from './wings.ts';
import {
  FLIGHT_CEILING_MM,
  LOOKAHEAD_S,
  clampLandTarget,
  loomingHit,
  obbAabbHull,
  orbitRadiusFloor,
  resolveSolids,
  yawAwayFromBox,
  type Aabb3,
  type Normal3,
  type Obb3,
} from './collision.ts';
import { TUB_MM, bodyCollisionPadMm } from '../scene/scale.ts';

export const SACCADE_TURN_S = 0.05;
export const SACCADE_STRAIGHT_MIN_S = 0.15;
export const SACCADE_STRAIGHT_MAX_S = 0.6;
export const BANK_DEG_MIN = 20;
export const BANK_DEG_MAX = 30;
export const WOBBLE_HZ = 1.5;
export const WOBBLE_MM = 3;
/**
 * Authored orbit band. The effective minimum is raised per world by
 * `orbitRadiusFloor` (box diagonal + body pad + clearance); see collision.ts.
 */
export const ORBIT_RADIUS_MIN = 60;
export const ORBIT_RADIUS_MAX = 120;
/** Extra XZ clearance between the fly centre and any solid's corner while orbiting. */
export const ORBIT_CLEARANCE_MM = 8;
export const ORBIT_SACCADE_MIN_S = 0.2;
export const ORBIT_SACCADE_MAX_S = 0.5;
export const EYE_FOV_DEG = 150;
export const LAND_FORELEG_DEG = 60;
export const LAND_FORELEG_S = 0.12;
export const LAND_SQUASH_S = 0.04;
export const LAND_FOLD_S = 0.2;
export const TAKEOFF_RAISE_S = 0.06;
export const TAKEOFF_HOP_MM = 8;
export const TAKEOFF2_TUMBLE_S = 0.3;
export const TAKEOFF2_TURNS = 2;
export const CRUISE_MM_S = 90;
export const LAND_TAU_S = 0.45;
/** Largest XZ half-extent of the twaróg block (100 × 80 mm → 50). Used for angular size. */
export const FOOD_HALF_SIZE_MM = TUB_MM.diameter / 2;
export { LOOKAHEAD_S, FLIGHT_CEILING_MM };

export type Vec3 = { x: number; y: number; z: number };

export type FlightKind = 'orbit' | 'land' | 'takeoff1' | 'takeoff2' | 'exit' | 'idle';

export type FlightLandPhase = 'face' | 'decel' | 'extend' | 'squash' | 'fold' | 'done';

export type FlightFrame = {
  kind: FlightKind;
  done: boolean;
  position: Vec3;
  velocity: Vec3;
  heading: number;
  bank: number;
  pitch: number;
  roll: number;
  wingRaise: number;
  blurAlpha: number;
  flicker: number;
  forelegExtend: number;
  circuits: number;
  landPhase: FlightLandPhase | null;
  hopPeakMm: number;
};

export type OrbitOpts = {
  target: Vec3;
  circuits: number;
  radius?: number;
  altitude?: number;
  descend?: boolean;
  seed?: number;
};

export type LandOpts = {
  target: Vec3;
  supportY: number;
  seed?: number;
};

function rngRange(rng: Xoshiro128ss, lo: number, hi: number): number {
  return lo + rng.nextFloat() * (hi - lo);
}

/** Angular size (degrees) of a target of half-width `half` at distance `d`. */
export function angularSizeDeg(distance: number, half = FOOD_HALF_SIZE_MM): number {
  const d = Math.max(1e-3, distance);
  return 2 * Math.atan(half / d) * (180 / Math.PI);
}

export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

type Segment = { kind: 'straight' | 'turn'; duration: number; heading: number; bank: number };

/**
 * Piecewise-saccade path: straight 150–600 ms, then a ~90° yaw in 50 ms
 * with 20–30° bank. Used by orbit and free cruise.
 */
export function buildSaccadePlan(
  rng: Xoshiro128ss,
  startHeading: number,
  count: number,
): Segment[] {
  const segs: Segment[] = [];
  let heading = startHeading;
  for (let i = 0; i < count; i++) {
    segs.push({
      kind: 'straight',
      duration: rngRange(rng, SACCADE_STRAIGHT_MIN_S, SACCADE_STRAIGHT_MAX_S),
      heading,
      bank: 0,
    });
    const dir = rng.nextFloat() < 0.5 ? 1 : -1;
    heading = wrapPi(heading + dir * Math.PI / 2);
    segs.push({
      kind: 'turn',
      duration: SACCADE_TURN_S,
      heading,
      bank: dir * rngRange(rng, BANK_DEG_MIN, BANK_DEG_MAX) * Math.PI / 180,
    });
  }
  return segs;
}

export class FlightController {
  kind: FlightKind = 'idle';
  done = false;
  position: Vec3 = { x: 0, y: 2, z: 0 };
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  heading = 0;
  bank = 0;
  pitch = 0;
  roll = 0;
  wingRaise = 0;
  blurAlpha = 0;
  flicker = 0;
  forelegExtend = 0;
  circuits = 0;
  landPhase: FlightLandPhase | null = null;
  hopPeakMm = 0;

  private time = 0;
  private rng = new Xoshiro128ss(1);
  private target: Vec3 = { x: 0, y: 0, z: 0 };
  private supportY = 0;
  private altitude = 28;
  private radius = 90;
  private circuitsNeeded = 2;
  private orbitAngle = 0;
  private descend = false;
  private startRadius = 90;
  private startAlt = 28;
  private segs: Segment[] = [];
  private segIndex = 0;
  private segT = 0;
  private hopT = 0;
  private hopY0 = 0;
  private raiseT = 0;
  private foldT = 0;
  private squashT = 0;
  private tumbleT = 0;
  private recoverHeading = 0;
  private startHeading = 0;
  private startPos: Vec3 = { x: 0, y: 0, z: 0 };
  private landSpeed = CRUISE_MM_S;
  private blurOut = 0;
  private obstacles: Aabb3[] = [];
  private obbs: Obb3[] = [];
  private floorY = 0;
  private ceilingY = FLIGHT_CEILING_MM;
  /** Normal of the face we were last pushed out along; hysteresis for edge chatter. */
  private lastNormal: Normal3 | null = null;
  /** Solid hits this frame's update resolved (0 when the path is clear). */
  hitCount = 0;

  setWorld(opts: {
    obstacles?: Aabb3[];
    obbs?: Obb3[];
    floorY?: number;
    ceilingY?: number;
  }): void {
    if (opts.obstacles) this.obstacles = opts.obstacles;
    if (opts.obbs) this.obbs = opts.obbs;
    if (opts.floorY !== undefined) this.floorY = opts.floorY;
    if (opts.ceilingY !== undefined) this.ceilingY = opts.ceilingY;
  }

  snapshot(): FlightFrame {
    return {
      kind: this.kind,
      done: this.done,
      position: { ...this.position },
      velocity: { ...this.velocity },
      heading: this.heading,
      bank: this.bank,
      pitch: this.pitch,
      roll: this.roll,
      wingRaise: this.wingRaise,
      blurAlpha: this.blurAlpha,
      flicker: this.flicker,
      forelegExtend: this.forelegExtend,
      circuits: this.circuits,
      landPhase: this.landPhase,
      hopPeakMm: this.hopPeakMm,
    };
  }

  place(position: Vec3, heading: number): void {
    this.position = { ...position };
    this.startPos = { ...position };
    this.heading = heading;
    this.startHeading = heading;
    this.velocity = { x: 0, y: 0, z: 0 };
  }

  startOrbit(opts: OrbitOpts): void {
    this.kind = 'orbit';
    this.done = false;
    this.time = 0;
    this.rng = new Xoshiro128ss(opts.seed ?? 1);
    this.target = { ...opts.target };
    this.circuitsNeeded = opts.circuits;
    this.circuits = 0;
    this.altitude = opts.altitude ?? 28;
    this.startAlt = this.altitude;
    const floor = this.orbitFloor();
    this.radius = Math.max(floor, opts.radius ?? rngRange(this.rng, ORBIT_RADIUS_MIN, ORBIT_RADIUS_MAX));
    this.startRadius = this.radius;
    this.descend = !!opts.descend;
    this.orbitAngle = Math.atan2(this.position.x - this.target.x, this.position.z - this.target.z);
    this.heading = wrapPi(this.orbitAngle + Math.PI / 2);
    this.wingRaise = 1;
    this.blurAlpha = 1;
    this.forelegExtend = 0;
    this.landPhase = null;
    this.segs = buildSaccadePlan(this.rng, this.heading, 24);
    this.segIndex = 0;
    this.segT = 0;
    this.blurOut = 0;
  }

  startLand(opts: LandOpts): void {
    this.kind = 'land';
    this.done = false;
    this.time = 0;
    this.rng = new Xoshiro128ss(opts.seed ?? 1);
    const clamped = clampLandTarget(opts.target, opts.supportY, this.obstacles);
    this.target = clamped;
    this.supportY = Math.max(opts.supportY, clamped.y);
    this.landPhase = 'face';
    this.forelegExtend = 0;
    this.wingRaise = 1;
    this.blurAlpha = 1;
    this.landSpeed = Math.max(20, Math.hypot(this.velocity.x, this.velocity.z) || CRUISE_MM_S);
    this.squashT = 0;
    this.foldT = 0;
    this.roll = 0;
  }

  startTakeoff1(): void {
    this.kind = 'takeoff1';
    this.done = false;
    this.time = 0;
    this.raiseT = 0;
    this.hopT = 0;
    this.hopY0 = this.position.y;
    this.hopPeakMm = 0;
    this.wingRaise = 0;
    this.blurAlpha = 0;
    this.forelegExtend = 0;
    this.landPhase = null;
    this.pitch = 0;
    this.bank = 0;
    this.roll = 0;
  }

  startTakeoff2(recover: Vec3): void {
    this.kind = 'takeoff2';
    this.done = false;
    this.time = 0;
    this.hopT = 0;
    this.tumbleT = 0;
    this.hopY0 = this.position.y;
    this.hopPeakMm = 0;
    this.target = clampLandTarget(recover, recover.y, this.obstacles);
    this.recoverHeading = Math.atan2(this.target.x - this.position.x, this.target.z - this.position.z);
    this.wingRaise = 0;
    this.blurAlpha = 0;
    this.forelegExtend = 0;
    this.landPhase = null;
    this.roll = 0;
  }

  startExit(heading = this.heading): void {
    this.kind = 'exit';
    this.done = false;
    this.time = 0;
    this.heading = heading;
    this.wingRaise = 1;
    this.blurAlpha = 1;
    this.forelegExtend = 0;
    this.landPhase = null;
  }

  update(dt: number): FlightFrame {
    const step = Math.max(0, dt);
    this.time += step;
    this.flicker = Math.sin(this.time * Math.PI * 2 * WING_FLICKER_HZ) * WING_FLICKER_DEG;
    switch (this.kind) {
      case 'orbit': this.stepOrbit(step); break;
      case 'land': this.stepLand(step); break;
      case 'takeoff1': this.stepTakeoff1(step); break;
      case 'takeoff2': this.stepTakeoff2(step); break;
      case 'exit': this.stepExit(step); break;
      default: break;
    }
    this.steerAroundSolids();
    this.applySolidConstraints();
    return this.snapshot();
  }

  private wobbleY(base: number): number {
    return base
      + WOBBLE_MM * Math.sin(2 * Math.PI * WOBBLE_HZ * this.time)
      + perlin1(this.time * 0.35, 3) * 1.6;
  }

  private stepOrbit(dt: number): void {
    const angSpeed = CRUISE_MM_S / Math.max(20, this.radius);
    this.orbitAngle += angSpeed * dt;
    this.circuits = Math.floor(this.orbitAngle / (2 * Math.PI));
    const angle = wrapPi(this.orbitAngle);
    const tOrbit = this.orbitAngle / (2 * Math.PI);
    if (this.descend) {
      const u = clamp01(tOrbit / Math.max(0.001, this.circuitsNeeded));
      this.radius = lerp(this.startRadius, Math.max(ORBIT_RADIUS_MIN, this.orbitFloor()), u);
      this.altitude = lerp(this.startAlt, 14, u);
    }
    const seg = this.segs[this.segIndex];
    if (seg) {
      this.segT += dt;
      if (seg.kind === 'turn') {
        this.heading = wrapPi(this.heading + headingError(this.heading, seg.heading) * Math.min(1, dt / Math.max(1e-4, seg.duration - this.segT + dt)));
        this.bank = lerp(this.bank, seg.bank, 1 - Math.exp(-dt / 0.03));
      } else {
        const tangent = wrapPi(angle + Math.PI / 2);
        this.heading = wrapPi(this.heading + headingError(this.heading, tangent) * Math.min(1, dt * 4));
        this.bank = lerp(this.bank, 0, 1 - Math.exp(-dt / 0.08));
      }
      if (this.segT >= seg.duration) {
        this.segT = 0;
        this.segIndex = (this.segIndex + 1) % this.segs.length;
      }
    }
    this.position.x = this.target.x + Math.sin(angle) * this.radius;
    this.position.z = this.target.z + Math.cos(angle) * this.radius;
    this.position.y = this.wobbleY(this.altitude);
    this.velocity.x = Math.cos(angle) * CRUISE_MM_S;
    this.velocity.z = -Math.sin(angle) * CRUISE_MM_S;
    this.velocity.y = 0;
    this.pitch = 0;
    this.wingRaise = 1;
    this.blurAlpha = 1;
    if (this.circuits >= this.circuitsNeeded) this.done = true;
  }

  private stepLand(dt: number): void {
    const dist = horizontalDistance(this.position, this.target);
    const size = angularSizeDeg(dist);
    const yawTo = Math.atan2(this.target.x - this.position.x, this.target.z - this.position.z);

    if (this.landPhase === 'face') {
      this.heading = wrapPi(this.heading + Math.sign(headingError(this.heading, yawTo)) * Math.min(Math.abs(headingError(this.heading, yawTo)), (Math.PI / 2) * (dt / SACCADE_TURN_S)));
      this.bank = lerp(this.bank, Math.sign(headingError(this.heading, yawTo) || 1) * 0.4, 0.4);
      if (Math.abs(headingError(this.heading, yawTo)) < 0.08) this.landPhase = 'decel';
      return;
    }

    if (this.landPhase === 'decel' || this.landPhase === 'extend') {
      const speed = dist / LAND_TAU_S;
      this.landSpeed = lerp(this.landSpeed, clamp(speed, 8, CRUISE_MM_S), 1 - Math.exp(-dt / 0.12));
      const step = this.landSpeed * dt;
      if (dist > 0.4) {
        this.position.x += (this.target.x - this.position.x) / dist * Math.min(step, dist);
        this.position.z += (this.target.z - this.position.z) / dist * Math.min(step, dist);
      }
      const yTarget = this.supportY;
      this.position.y = lerp(this.position.y, yTarget, 1 - Math.exp(-dt / 0.18));
      this.heading = yawTo;
      this.bank = lerp(this.bank, 0, 0.2);
      this.pitch = dist > 12 ? 0.12 : lerp(this.pitch, 0, 0.3);
      this.velocity.x = Math.sin(this.heading) * this.landSpeed;
      this.velocity.z = Math.cos(this.heading) * this.landSpeed;
      if (size >= LAND_FORELEG_DEG || dist < 18) {
        this.landPhase = 'extend';
        this.forelegExtend = clamp01(this.forelegExtend + dt / LAND_FORELEG_S);
      }
      if (dist < 1.2 && Math.abs(this.position.y - yTarget) < 1.5) {
        this.landPhase = 'squash';
        this.squashT = 0;
      }
      return;
    }

    if (this.landPhase === 'squash') {
      this.squashT += dt;
      this.position.x = this.target.x;
      this.position.z = this.target.z;
      this.position.y = this.supportY - 0.6 * Math.sin(Math.PI * clamp01(this.squashT / LAND_SQUASH_S));
      this.forelegExtend = 1;
      this.pitch = 0.08;
      if (this.squashT >= LAND_SQUASH_S) {
        this.landPhase = 'fold';
        this.foldT = 0;
      }
      return;
    }

    if (this.landPhase === 'fold') {
      this.foldT += dt;
      const u = clamp01(this.foldT / LAND_FOLD_S);
      this.wingRaise = 1 - u;
      this.blurAlpha = Math.max(0, 1 - this.foldT / BLUR_LAND_FADE_S);
      this.position.y = this.supportY;
      this.pitch = 0;
      this.bank = 0;
      this.velocity = { x: 0, y: 0, z: 0 };
      if (u >= 1 && this.blurAlpha <= 0.02) {
        this.landPhase = 'done';
        this.done = true;
        this.forelegExtend = 0;
        this.blurAlpha = 0;
        this.wingRaise = 0;
      }
    }
  }

  private stepTakeoff1(dt: number): void {
    if (this.raiseT < TAKEOFF_RAISE_S) {
      this.raiseT += dt;
      this.wingRaise = clamp01(this.raiseT / TAKEOFF_RAISE_S);
      this.velocity = { x: 0, y: 0, z: 0 };
      return;
    }
    this.hopT += dt;
    const hopDur = 0.22;
    const u = clamp01(this.hopT / hopDur);
    const hop = TAKEOFF_HOP_MM * Math.sin(Math.PI * Math.min(1, u));
    this.hopPeakMm = Math.max(this.hopPeakMm, hop);
    this.position.y = this.hopY0 + hop;
    this.blurAlpha = clamp01(u * 1.4);
    this.wingRaise = 1;
    this.velocity.y = (Math.PI * TAKEOFF_HOP_MM / hopDur) * Math.cos(Math.PI * u);
    this.pitch = u < 0.5 ? 0.2 : 0.05;
    if (u >= 1) {
      this.position.y = this.hopY0 + 10;
      this.done = true;
      this.velocity.y = 18;
    }
  }

  private stepTakeoff2(dt: number): void {
    const hopDur = 0.12;
    if (this.hopT < hopDur) {
      this.hopT += dt;
      const u = clamp01(this.hopT / hopDur);
      const hop = TAKEOFF_HOP_MM * 0.7 * Math.sin(Math.PI * u);
      this.hopPeakMm = Math.max(this.hopPeakMm, hop);
      this.position.y = this.hopY0 + hop;
      this.wingRaise = 0;
      this.blurAlpha = 0;
      return;
    }
    this.tumbleT += dt;
    const u = clamp01(this.tumbleT / TAKEOFF2_TUMBLE_S);
    this.roll = u * TAKEOFF2_TURNS * Math.PI * 2;
    this.wingRaise = u > 0.45 ? clamp01((u - 0.45) / 0.3) : 0;
    this.blurAlpha = this.wingRaise;
    this.heading = wrapPi(this.heading + headingError(this.heading, this.recoverHeading) * dt * 3);
    const dist = horizontalDistance(this.position, this.target);
    if (dist > 1) {
      const step = 140 * dt;
      this.position.x += (this.target.x - this.position.x) / dist * Math.min(step, dist);
      this.position.z += (this.target.z - this.position.z) / dist * Math.min(step, dist);
    }
    this.position.y = lerp(this.position.y, this.target.y, 1 - Math.exp(-dt / 0.18));
    if (u >= 1 && dist < 4) {
      this.done = true;
      this.roll = 0;
      this.wingRaise = 0;
      this.blurAlpha = 0;
    }
    if (this.time > 1.5) {
      this.position.x = this.target.x;
      this.position.z = this.target.z;
      this.position.y = this.target.y;
      this.done = true;
      this.roll = 0;
    }
  }

  private stepExit(dt: number): void {
    this.position.x += Math.sin(this.heading) * CRUISE_MM_S * 1.4 * dt;
    this.position.z += Math.cos(this.heading) * CRUISE_MM_S * 1.4 * dt;
    this.position.y = this.wobbleY(this.position.y + 40 * dt);
    this.wingRaise = 1;
    this.blurAlpha = 1;
    if (this.time >= 1.1) this.done = true;
  }

  private landingOn(box: Aabb3): boolean {
    if (this.kind !== 'land' && this.kind !== 'takeoff2') return false;
    return this.target.y + 0.5 >= box.cy + box.hy
      && Math.abs(this.target.x - box.cx) <= box.hx + 4
      && Math.abs(this.target.z - box.cz) <= box.hz + 4;
  }

  private steerAroundSolids(): void {
    if (this.kind === 'idle' || this.kind === 'takeoff1') return;
    const speed = Math.hypot(this.velocity.x, this.velocity.z) || CRUISE_MM_S;
    const hx = Math.sin(this.heading);
    const hz = Math.cos(this.heading);
    const ahead = {
      x: this.position.x + (Math.abs(this.velocity.x) > 1 ? this.velocity.x : hx * speed) * LOOKAHEAD_S,
      y: this.position.y + this.velocity.y * LOOKAHEAD_S,
      z: this.position.z + (Math.abs(this.velocity.z) > 1 ? this.velocity.z : hz * speed) * LOOKAHEAD_S,
    };
    const boxes = this.obstacles.filter((b) => !this.landingOn(b));
    const obbs = this.obbs.filter((o) => !this.landingOn(obbAabbHull(o)));
    const hit = loomingHit(this.position, ahead, boxes, obbs);
    if (!hit) return;
    this.heading = wrapPi(yawAwayFromBox(this.position, hit, this.heading));
    if (this.kind === 'orbit') {
      this.radius += 12;
      this.startRadius = Math.max(this.startRadius, this.radius);
    }
  }

  private supportFloor(): number {
    let floor = this.floorY;
    for (const box of this.obstacles) {
      if (
        Math.abs(this.position.x - box.cx) <= box.hx
        && Math.abs(this.position.z - box.cz) <= box.hz
      ) {
        floor = Math.max(floor, box.cy + box.hy);
      }
    }
    for (const obb of this.obbs) {
      const hull = obbAabbHull(obb);
      if (
        Math.abs(this.position.x - hull.cx) <= hull.hx
        && Math.abs(this.position.z - hull.cz) <= hull.hz
      ) {
        const local = {
          x: (this.position.x - obb.cx) * Math.cos(obb.yaw) - (this.position.z - obb.cz) * Math.sin(obb.yaw),
          z: (this.position.x - obb.cx) * Math.sin(obb.yaw) + (this.position.z - obb.cz) * Math.cos(obb.yaw),
        };
        if (Math.abs(local.x) <= obb.hx && Math.abs(local.z) <= obb.hz) {
          floor = Math.max(floor, obb.cy + obb.hy);
        }
      }
    }
    return floor;
  }

  /**
   * Smallest orbit radius that clears every solid whose footprint holds the
   * orbit target (the twaróg when orbiting the food). Solids elsewhere are
   * handled by `steerAroundSolids`, not by widening the circle.
   */
  orbitFloor(): number {
    const pad = bodyCollisionPadMm();
    let floor = 0;
    // The table and the board hold the food in XZ too, but orbiting outside
    // a 400 mm board is not what "orbit the twaróg" means: only the solid the
    // target actually sits inside (3D, small tolerance) constrains the circle.
    const constrains = (b: Aabb3) =>
      Math.abs(this.target.x - b.cx) <= b.hx + 1
      && Math.abs(this.target.z - b.cz) <= b.hz + 1
      && Math.abs(this.target.y - b.cy) <= b.hy + 1;
    for (const box of this.obstacles) {
      if (constrains(box)) floor = Math.max(floor, orbitRadiusFloor(box, pad, ORBIT_CLEARANCE_MM));
    }
    for (const obb of this.obbs) {
      const hull = obbAabbHull(obb);
      if (constrains(hull)) floor = Math.max(floor, orbitRadiusFloor(hull, pad, ORBIT_CLEARANCE_MM));
    }
    return floor;
  }

  private applySolidConstraints(): void {
    const out = resolveSolids(this.position, this.velocity, this.obstacles, this.obbs, 0, this.lastNormal);
    this.position = out.position;
    this.velocity = out.velocity;
    this.hitCount = out.hit ? this.hitCount + 1 : 0;
    if (out.normal) this.lastNormal = out.normal;
    else if (!out.hit) this.lastNormal = null;
    this.position.y = clamp(this.position.y, this.supportFloor(), this.ceilingY);
  }
}
