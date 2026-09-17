/**
 * Orchestrates authored locomotion / comedy and the MN9 feeding gate.
 *
 * The connectome drives only gustatory channel → MN9 (the feeding FSM inside
 * EAT). Flight, walking, grooming, sleep and gags are authored and never
 * write into ActivityFrame or the brain worker. See docs/BODY-MODEL.md.
 */
import * as THREE from 'three';
import { CLIP_DURATION, MotionMixer, overlayEuler, replaceEuler } from './feedingMotion.ts';
import { FeedingStateMachine, SATIETY_RETRACT } from './feedingStateMachine.ts';
import { odorConcentration, odorGradientYaw } from './odorField.ts';
import type { ClipName, FeedingEvent, FeedingState, Pose } from './types.ts';
import { TWAROG_MAMUTA_WANILIOWY } from '../food/foodProfile.ts';
import {
  TwarogSystem,
  clampOutsideXzObb,
  pointInXzAabb,
  type ChemoSample,
  type ChunkRecord,
  type ConsumeEvent,
  type Vec3,
} from '../food/twarogSystem.ts';
import {
  FLY_WALK_MM_S,
  POUCH_BASE_HEIGHT_MM,
  boardTopY,
  bodyCollisionPadMm,
  flyVisualLengthMm,
  labellumRestReachMm,
  standoffMm,
} from '../scene/scale.ts';
import { FlightController } from './flight.ts';
import {
  FLIGHT_CEILING_MM,
  LOOKAHEAD_S,
  resolveSolids,
  slerpTowardUpCone,
  type Aabb3,
  type Obb3,
} from './collision.ts';
import { TABLE_THICKNESS_MM } from '../scene/proceduralMaps.ts';
import {
  GROOM_FULL_S,
  GROOM_SHORT_S,
  applyGroomNap,
  groomFullOverlay,
  groomShortOverlay,
  napOverlay,
  wakeOverlay,
} from './grooming.ts';
import { GagPlayer, type CrumbBone, type GagId } from './gags.ts';
import {
  SceneLoop,
  isEatState,
  isFlightState,
  isWalkState,
  type LoopState,
  type LoopVariant,
} from './sceneLoop.ts';
import { kitchenLayout } from '../scene/layout.ts';
import { headingError, clamp, clamp01, easeInOut, lerp } from './math.ts';
import { gaitPoseAtDistance } from './gait.ts';
import { wingIdleFlick } from './wings.ts';

export type LocomotionMode = 'ground' | 'flight' | 'onFood';

/** Board → table (or table → board) step. Authored, not a teleport. */
export const BOARD_STEP_S = 0.2;
export const BOARD_STEP_HOP_MM = 3;

export type PouchObb = {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw: number;
};

export type FlyPose = {
  position: THREE.Vector3;
  heading: number;
  pitch: number;
  bank: number;
  roll: number;
  clipName: ClipName;
  clipTime: number;
  pumpAmplitude: number;
  pose: Pose;
  abdomenScale: number;
  wingRaiseL: number;
  wingRaiseR: number;
  wingSongL: number;
  wingSongR: number;
  wingBlurAlphaL: number;
  wingBlurAlphaR: number;
  wingFlicker: number;
  wingFlickL: number;
  wingFlickR: number;
  forelegExtend: number;
};

export type CameraAim = {
  x: number;
  y: number;
  z: number;
};

export type DirectorInput = {
  dt: number;
  /** Hemolymph coupling: MN9 rate, satiety and bitter from App's Hemolymph. */
  mn9Rate: number;
  satiety: number;
  bitter: number;
  odor: number;
  cameraDist: number;
  cropVolume?: number;
};

export type DirectorOutput = {
  flyPose: FlyPose;
  cameraAim: CameraAim;
  events: FeedingEvent[];
  chemo: ChemoSample | null;
  state: FeedingState;
  hudState: FeedingState;
  mode: LocomotionMode;
  walk: number;
  portions: number | null;
  crumbs: ConsumeEvent[];
  caption: string;
  macro: LoopState | 'GROUND';
  gag: GagId | null;
  spoonShadow: number;
  crumbAttach: CrumbBone;
  /**
   * Morsel held between the forelegs while PUMP consumes a chunk. `progress`
   * is the measured `TwarogSystem.consumeProgress` (0 → 1); the visual shrinks
   * with it. Null outside PUMP. Authored prop, see docs/BODY-MODEL.md.
   */
  heldCrumb: { progress: number; chunkIndex: number } | null;
  bites: number;
  bitesTarget: number;
  remainingFrac: number;
  portionCount: number;
  gramsEaten: number;
  loopWrapped: boolean;
};

export type ContactSample = {
  labellum: Vec3;
  sensors: readonly Vec3[];
};

export type SceneDirectorDeps = {
  food: TwarogSystem;
  foodOrigin: Vec3;
  pouch: PouchObb;
  position: Vec3;
  heading?: number;
  seed?: number;
  /** Default false so the ground-trace fixture stays bit-identical. */
  scriptedLoop?: boolean;
  /** Default `reel`. `full` restores ORBIT / EXIT_FRAME (`?loop=full`). */
  loopVariant?: LoopVariant;
  sampleContacts?: (args: {
    position: Vec3;
    heading: number;
    pose: Pose;
  }) => ContactSample;
};

function kinematicContacts(position: Vec3, heading: number, foodOrigin: Vec3, sensorY?: number): ContactSample {
  const reach = labellumRestReachMm();
  const y = sensorY ?? position.y;
  const labW = {
    x: position.x + Math.sin(heading) * reach,
    y,
    z: position.z + Math.cos(heading) * reach,
  };
  const labellum = {
    x: labW.x - foodOrigin.x,
    y: labW.y - foodOrigin.y,
    z: labW.z - foodOrigin.z,
  };
  return { labellum, sensors: [labellum, labellum, labellum, labellum] };
}

export class SceneDirector {
  readonly food: TwarogSystem;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  heading: number;
  mode: LocomotionMode = 'ground';
  readonly fsm: FeedingStateMachine;
  readonly mixer = new MotionMixer();
  readonly flight = new FlightController();
  readonly loop: SceneLoop;
  readonly gags = new GagPlayer();
  readonly scriptedLoop: boolean;
  readonly loopVariant: LoopVariant;

  private readonly foodOrigin: Vec3;
  private readonly pouch: PouchObb;
  private readonly spawn: THREE.Vector3;
  private readonly spawnHeading: number;
  private readonly sampleContacts?: SceneDirectorDeps['sampleContacts'];
  private refillClip: 'retract' | 'groom' | null = null;
  private refillHold = 0;
  private hudState: FeedingState = 'SEARCH';
  private seed: number;
  private lastLoop: LoopState = 'EAT_TOP';
  private loopWrapped = false;
  private eatSawRest = false;
  private eatSatietyRetract = false;
  private walkGoal: { x: number; z: number } | null = null;
  private glueIndex: number | null = null;
  private groomT = 0;
  private napT = 0;
  private wakeT = 0;
  private pitch = 0;
  private bank = 0;
  private roll = 0;
  private wingRaiseL = 0;
  private wingRaiseR = 0;
  private wingSongL = 0;
  private wingSongR = 0;
  private wingBlurL = 0;
  private wingBlurR = 0;
  private wingFlicker = 0;
  private wingFlickL = 0;
  private wingFlickR = 0;
  private forelegExtend = 0;
  private caption = '';
  private spoonShadow = 0;
  private crumbAttach: CrumbBone = null;
  private onWall = false;
  private napDoubled = false;
  private simTime = 0;
  private gaitDistance = 0;
  private lastX = 0;
  private lastZ = 0;
  private lastHeading = 0;
  private standOffset = 2;
  private stepping = false;
  private stepT = 0;
  private stepFromY = 0;
  private stepToY = 0;

  constructor(deps: SceneDirectorDeps) {
    this.food = deps.food;
    this.foodOrigin = { x: deps.foodOrigin.x, y: deps.foodOrigin.y, z: deps.foodOrigin.z };
    this.pouch = deps.pouch;
    this.spawn = new THREE.Vector3(deps.position.x, deps.position.y, deps.position.z);
    this.spawnHeading = deps.heading ?? 0.35;
    this.position = this.spawn.clone();
    this.standOffset = this.spawn.y - this.food.supportHeightAt(this.spawn.x, this.spawn.z, this.foodOrigin);
    this.velocity = new THREE.Vector3();
    this.heading = this.spawnHeading;
    this.fsm = new FeedingStateMachine({ heading: this.spawnHeading });
    this.sampleContacts = deps.sampleContacts;
    this.scriptedLoop = !!deps.scriptedLoop;
    this.loopVariant = deps.loopVariant ?? 'reel';
    this.seed = deps.seed ?? 1;
    this.loop = new SceneLoop(this.seed, this.loopVariant);
    this.lastLoop = this.loop.state;
    this.mixer.play('odorTrack', { fade: 0 });
    this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
    this.syncFlightWorld();
    this.lastX = this.position.x;
    this.lastZ = this.position.z;
    this.lastHeading = this.heading;
    if (this.scriptedLoop) this.beginLoopState(this.loop.state);
  }

  reset(seed: number): void {
    this.seed = seed;
    this.fsm.reset(this.spawnHeading);
    this.heading = this.spawnHeading;
    this.position.copy(this.spawn);
    this.velocity.set(0, 0, 0);
    this.mode = 'ground';
    this.refillClip = null;
    this.refillHold = 0;
    this.hudState = 'SEARCH';
    this.mixer.play('odorTrack', { fade: 0, restart: true });
    this.mixer.setAmplitude(0);
    this.pitch = 0;
    this.bank = 0;
    this.roll = 0;
    this.wingRaiseL = 0;
    this.wingRaiseR = 0;
    this.wingBlurL = 0;
    this.wingBlurR = 0;
    this.wingSongL = 0;
    this.wingSongR = 0;
    this.wingFlicker = 0;
    this.wingFlickL = 0;
    this.wingFlickR = 0;
    this.caption = '';
    this.spoonShadow = 0;
    this.crumbAttach = null;
    this.onWall = false;
    this.eatSawRest = false;
    this.eatSatietyRetract = false;
    this.walkGoal = null;
    this.glueIndex = null;
    this.simTime = 0;
    this.gaitDistance = 0;
    this.lastX = this.position.x;
    this.lastZ = this.position.z;
    this.lastHeading = this.heading;
    this.stepping = false;
    this.stepT = 0;
    this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
    this.loop.reset(seed);
    if (this.scriptedLoop) this.beginLoopState(this.loop.state);
  }

  update(input: DirectorInput): DirectorOutput {
    if (!this.scriptedLoop) return this.updateLegacyGround(input);
    return this.updateLoop(input);
  }

  private beginLoopState(state: LoopState): void {
    this.lastLoop = state;
    this.eatSawRest = false;
    this.eatSatietyRetract = false;
    this.walkGoal = null;
    this.glueIndex = null;
    this.groomT = 0;
    this.napT = 0;
    this.wakeT = 0;
    this.onWall = false;
    this.caption = '';
    this.spoonShadow = 0;
    this.crumbAttach = null;
    this.napDoubled = false;
    const food = this.foodOrigin;
    this.syncFlightWorld();
    if (state === 'ORBIT' || state === 'ORBIT_SHORT') {
      this.mode = 'flight';
      this.flight.place({ x: this.position.x, y: Math.max(this.position.y, boardTopY() + 18), z: this.position.z }, this.heading);
      this.flight.startOrbit({
        target: food,
        circuits: state === 'ORBIT_SHORT' ? 1 : this.loop.orbitCircuits,
        descend: state === 'ORBIT',
        seed: this.seed + (state === 'ORBIT_SHORT' ? 3 : 0),
      });
    } else if (state === 'LAND_TOP') {
      this.mode = 'flight';
      const support = this.surfaceYAt(food.x, food.z);
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startLand({ target: { x: food.x, y: support, z: food.z }, supportY: support, seed: this.seed + 5 });
    } else if (state === 'LAND_TABLE') {
      this.mode = 'flight';
      const targetXZ = this.loopVariant === 'reel'
        ? this.sideStandPoint()
        : { x: kitchenLayout().fly.x, z: kitchenLayout().fly.z };
      const support = this.surfaceYAt(targetXZ.x, targetXZ.z);
      const target = { x: targetXZ.x, y: support, z: targetXZ.z };
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startLand({ target, supportY: support, seed: this.seed + 7 });
    } else if (state === 'TAKEOFF_1' || state === 'TAKEOFF_EXIT') {
      this.mode = 'flight';
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startTakeoff1();
    } else if (state === 'EXIT_FRAME') {
      this.mode = 'flight';
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startExit(this.heading);
    } else if (state === 'EAT_TOP') {
      this.mixer.play('odorTrack', { fade: 0, restart: true });
      if (this.loopVariant === 'reel') this.placeOnFoodTop({ taste: true });
      else {
        this.fsm.reset(this.heading);
        this.mode = 'onFood';
      }
    } else if (state === 'EAT_SIDE' || state === 'EAT_SIDE_2') {
      this.mixer.play('odorTrack', { fade: 0, restart: true });
      if (this.loopVariant === 'reel') this.placeOnFoodSide({ taste: true });
      else {
        this.fsm.reset(this.heading);
        this.mode = 'ground';
      }
    } else if (state === 'WALK_TOP') {
      this.mode = 'onFood';
    } else if (state === 'WALK_REPOSITION') {
      this.walkGoal = this.pickWalkRepositionTarget();
      this.mode = this.overFood() ? 'onFood' : 'ground';
    } else if (state === 'NAP' || state === 'WAKE' || state === 'GROOM_SHORT' || state === 'GROOM_FULL') {
      if (state === 'NAP' && !this.overFood()) this.placeOnFoodTop({ taste: false });
      this.mode = this.overFood() ? 'onFood' : 'ground';
    } else if (state === 'GAG') {
      this.gags.start(this.loop.gag, this.gagCtx(0, 0));
    }
  }

  private gagCtx(satiety: number, cropVolume: number) {
    return {
      satiety,
      cropVolume,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      heading: this.heading,
      pouch: { x: this.pouch.cx, y: kitchenLayout().pouch.y, z: this.pouch.cz, yaw: this.pouch.yaw },
      food: this.foodOrigin,
      standingY: this.surfaceY(),
    };
  }

  private updateLoop(input: DirectorInput): DirectorOutput {
    const dt = input.dt;
    const crop = input.cropVolume ?? 0;
    this.loopWrapped = false;
    const flags = {
      flightDone: this.flight.kind !== 'idle' && this.flight.done,
      walkDone: false,
      eatBoutDone: this.loopVariant === 'full'
        ? this.eatSawRest && this.fsm.state === 'SEARCH'
        : this.eatSatietyRetract,
      groomDone: false,
      gagDone: this.loop.state === 'GAG' && this.loop.gag !== null ? !this.gags.active : this.loop.gag === null,
      napDone: false,
      wakeDone: false,
      satiety: input.satiety,
      cropVolume: crop,
    };

    if (isWalkState(this.loop.state)) {
      flags.walkDone = this.loop.state === 'WALK_TOP' ? this.stepWalkTop(dt) : this.stepWalkReposition(dt);
    } else if (this.loop.state === 'GROOM_SHORT') {
      this.groomT += dt;
      flags.groomDone = this.groomT >= GROOM_SHORT_S;
    } else if (this.loop.state === 'GROOM_FULL') {
      this.groomT += dt;
      flags.groomDone = this.groomT >= GROOM_FULL_S;
    } else if (this.loop.state === 'NAP') {
      this.napT += dt;
      flags.napDone = napOverlay(this.napT, input.satiety, this.napDoubled).done;
    } else if (this.loop.state === 'WAKE') {
      this.wakeT += dt;
      flags.wakeDone = wakeOverlay(this.wakeT).done;
    }

    const loopOut = this.loop.step(dt, flags);
    let extraPortion: number | null = null;
    if (loopOut.advanced || loopOut.state !== this.lastLoop) {
      if (loopOut.wrapped) {
        extraPortion = this.food.nextPortion();
        this.loopWrapped = true;
      }
      this.beginLoopState(loopOut.state);
    }

    let pose: Pose;
    let walk = 0;
    let pumpAmplitude = 0;
    const events: FeedingEvent[] = [];
    this.caption = loopOut.caption ?? '';
    this.spoonShadow = 0;
    this.crumbAttach = null;

    if (isFlightState(this.loop.state)) {
      this.syncFlightWorld();
      const frame = this.flight.update(dt);
      this.position.set(frame.position.x, frame.position.y, frame.position.z);
      this.velocity.set(frame.velocity.x, frame.velocity.y, frame.velocity.z);
      this.heading = frame.heading;
      this.pitch = frame.pitch;
      this.bank = frame.bank;
      this.roll = frame.roll;
      this.wingRaiseL = frame.wingRaise;
      this.wingRaiseR = frame.wingRaise;
      this.wingBlurL = frame.blurAlpha;
      this.wingBlurR = frame.blurAlpha;
      this.wingFlicker = frame.flicker;
      this.wingFlickL = 0;
      this.wingFlickR = 0;
      this.forelegExtend = frame.forelegExtend;
      this.mode = 'flight';
      this.mixer.play('idle');
      pose = overlayEuler(this.mixer.update(dt), {
        foreleg_L_tarsus: [55 * frame.forelegExtend, 0, 18 * frame.forelegExtend],
        foreleg_R_tarsus: [55 * frame.forelegExtend, 0, -18 * frame.forelegExtend],
      });
      pose = this.applyGait(pose, false, dt);
      this.hudState = 'SEARCH';
    } else if (this.loop.state === 'WALK_TOP' || this.loop.state === 'WALK_REPOSITION') {
      this.mixer.play('approach');
      pose = this.mixer.update(dt);
      this.forelegExtend = 0;
      this.hudState = 'APPROACH';
      pose = this.applyGait(pose, true, dt);
      this.applyGroundWings(false);
    } else if (this.loop.state === 'GROOM_SHORT' || this.loop.state === 'GROOM_FULL') {
      this.mixer.play('groom');
      pose = this.mixer.update(dt);
      const overlay = this.loop.state === 'GROOM_SHORT'
        ? groomShortOverlay(this.groomT)
        : groomFullOverlay(this.groomT);
      pose = applyGroomNap(pose, overlay);
      this.wingRaiseL = overlay.wingRaise;
      this.wingRaiseR = overlay.wingRaise;
      this.wingBlurL = 0;
      this.wingBlurR = 0;
      this.wingFlicker = 0;
      this.wingFlickL = 0;
      this.wingFlickR = 0;
      this.hudState = 'REST';
      pose = this.applyGait(pose, false, dt);
    } else if (this.loop.state === 'NAP') {
      this.mixer.play('idle');
      pose = applyGroomNap(this.mixer.update(dt), napOverlay(this.napT, input.satiety, this.napDoubled));
      this.position.y = this.surfaceY() - napOverlay(this.napT, input.satiety, this.napDoubled).sinkMm;
      this.caption = 'Trawi';
      this.hudState = 'REST';
      pose = this.applyGait(pose, false, dt);
      this.applyGroundWings(true);
    } else if (this.loop.state === 'WAKE') {
      this.mixer.play('idle');
      pose = applyGroomNap(this.mixer.update(dt), wakeOverlay(this.wakeT));
      this.hudState = 'SEARCH';
      pose = this.applyGait(pose, false, dt);
      this.applyGroundWings(true);
    } else if (this.loop.state === 'GAG') {
      pose = this.updateGag(dt, input, crop);
    } else {
      const fed = this.updateFeeding(input, this.loop.state === 'EAT_TOP' ? 'top' : 'side');
      pose = fed.pose;
      walk = fed.walk;
      pumpAmplitude = fed.pumpAmplitude;
      events.push(...fed.events);
    }

    this.applyConstraints(dt);
    this.glueToFood();
    const foodOut = this.stepFood(input, pose, isEatState(this.loop.state) && this.fsm.state === 'PUMP' && !this.refillClip);
    this.glueToFood();
    if (this.mode === 'onFood' && !this.onWall) this.position.y = this.surfaceY();
    const { crumbs, portions } = this.collectFood(foodOut.events, events);
    if (this.fsm.state === 'REST') this.eatSawRest = true;
    if (this.fsm.state === 'RETRACT' && input.satiety > SATIETY_RETRACT) this.eatSatietyRetract = true;
    if (extraPortion !== null) {
      events.push({ type: 'portion', count: extraPortion, t: this.fsm.time });
    }
    return this.packOutput(pose, pumpAmplitude, walk, events, foodOut.chemo, extraPortion ?? portions, crumbs, crop);
  }

  private updateGag(dt: number, input: DirectorInput, crop: number): Pose {
    const gag = this.gags.update(dt, this.gagCtx(input.satiety, crop));
    this.caption = gag.caption;
    this.spoonShadow = gag.spoonShadow;
    this.crumbAttach = gag.crumbAttach;
    if (gag.escape && this.flight.kind !== 'takeoff2') {
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      const support = this.food.supportHeightAt(this.foodOrigin.x, this.foodOrigin.z, this.foodOrigin) + this.spawn.y;
      this.syncFlightWorld();
      this.flight.startTakeoff2({ x: this.foodOrigin.x, y: support, z: this.foodOrigin.z });
    }
    if (gag.escape) {
      const frame = this.flight.update(dt);
      this.position.set(frame.position.x, frame.position.y, frame.position.z);
      this.heading = frame.heading;
      this.roll = frame.roll;
      this.wingRaiseL = frame.wingRaise;
      this.wingRaiseR = frame.wingRaise;
      this.wingBlurL = frame.blurAlpha;
      this.wingBlurR = frame.blurAlpha;
      this.wingFlicker = frame.flicker;
      this.mode = 'flight';
      this.mixer.play('idle');
      if (frame.done) this.gags.start(null, this.gagCtx(input.satiety, crop));
      return this.applyGait(this.mixer.update(dt), false, dt);
    }
    this.position.set(gag.position.x, gag.position.y, gag.position.z);
    this.heading = gag.heading;
    this.mode = gag.mode;
    this.wingRaiseL = gag.wingRaiseL;
    this.wingRaiseR = gag.wingRaiseR;
    this.wingSongL = gag.wingSongL;
    this.wingSongR = gag.wingSongR;
    this.wingBlurL = gag.wingBlurL;
    this.wingBlurR = gag.wingBlurR;
    this.wingFlicker = gag.wingFlicker;
    this.wingFlickL = 0;
    this.wingFlickR = 0;
    this.mixer.play('idle');
    if (gag.nap) this.napDoubled = gag.napDoubled;
    if (gag.done) this.gags.start(null, this.gagCtx(input.satiety, crop));
    this.hudState = 'REST';
    const walking = gag.mode !== 'flight';
    let pose = this.applyGait(this.mixer.update(dt), walking, dt);
    return overlayEuler(pose, gag.euler);
  }

  private stepWalkTop(dt: number): boolean {
    const target = {
      x: this.foodOrigin.x + this.food.biteFront.x,
      z: this.foodOrigin.z + this.food.biteFront.z,
    };
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    this.heading = Math.atan2(dx, dz);
    if (dist > 2) {
      this.position.x += (dx / dist) * FLY_WALK_MM_S * dt;
      this.position.z += (dz / dist) * FLY_WALK_MM_S * dt;
    }
    this.mode = 'onFood';
    return dist <= 3;
  }

  private stepWalkReposition(dt: number): boolean {
    if (!this.walkGoal) this.walkGoal = this.pickWalkRepositionTarget();
    const target = this.walkGoal;
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05) this.heading = Math.atan2(dx, dz);
    if (dist > 1) {
      const step = Math.min(dist, FLY_WALK_MM_S * dt);
      this.position.x += (dx / dist) * step;
      this.position.z += (dz / dist) * step;
    }
    this.mode = this.overFood() ? 'onFood' : 'ground';
    return dist <= 2;
  }

  private pickWalkRepositionTarget(): { x: number; z: number } {
    const bl = flyVisualLengthMm();
    const minD = 2 * bl;
    const maxD = 5 * bl;
    const origin = this.foodOrigin;
    const px = this.position.x;
    const pz = this.position.z;
    const aabb = this.food.worldAabb(origin);
    const inset = Math.min(2, aabb.hx * 0.2, aabb.hz * 0.2);
    const clampToFood = (x: number, z: number) => ({
      x: clamp(x, aabb.cx - aabb.hx + inset, aabb.cx + aabb.hx - inset),
      z: clamp(z, aabb.cz - aabb.hz + inset, aabb.cz + aabb.hz - inset),
    });
    let best: ChunkRecord | null = null;
    let bestScore = -Infinity;
    for (const c of this.food.chunks) {
      if (c.eaten) continue;
      const wx = origin.x + c.centroid.x;
      const wz = origin.z + c.centroid.z;
      const d = Math.hypot(wx - px, wz - pz);
      if (d < 0.4) continue;
      const inBand = d >= minD && d <= maxD;
      const ontoFood = this.loop.faceSwitched ? c.topY : 0;
      const score = (inBand ? 1000 : 0) + ontoFood + c.topY - Math.abs(d - 3.5 * bl) * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) return clampToFood(origin.x, origin.z);
    const wx = origin.x + best.centroid.x;
    const wz = origin.z + best.centroid.z;
    const d = Math.hypot(wx - px, wz - pz);
    if (this.loop.faceSwitched) return clampToFood(wx, wz);
    if (d > maxD && d > 1e-6) {
      return clampToFood(px + ((wx - px) / d) * maxD, pz + ((wz - pz) / d) * maxD);
    }
    if (d < minD && d > 1e-6) {
      return clampToFood(px + ((wx - px) / d) * minD, pz + ((wz - pz) / d) * minD);
    }
    return clampToFood(wx, wz);
  }

  private pickTopChunk(): ChunkRecord | null {
    let best: ChunkRecord | null = null;
    for (const c of this.food.chunks) {
      if (c.eaten) continue;
      if (!best || c.topY > best.topY) best = c;
    }
    return best;
  }

  private overFood(): boolean {
    const support = this.food.supportHeightAt(this.position.x, this.position.z, this.foodOrigin);
    if (support > boardTopY() + 0.5) return true;
    return pointInXzAabb({ x: this.position.x, z: this.position.z }, this.food.worldAabb(this.foodOrigin));
  }

  private sideStandPoint(): { x: number; z: number } {
    const probe = {
      x: this.foodOrigin.x,
      y: this.foodOrigin.y,
      z: this.foodOrigin.z + this.food.hz + standoffMm() + 12,
    };
    const ap = this.food.approachTarget(probe, this.foodOrigin);
    return { x: ap.point.x, z: ap.point.z };
  }

  private placeOnFoodTop(opts: { taste: boolean }): void {
    const chunk = this.pickTopChunk();
    if (!chunk) return;
    const x = this.foodOrigin.x + chunk.centroid.x;
    const z = this.foodOrigin.z + chunk.centroid.z;
    this.position.set(x, this.surfaceYAt(x, z), z);
    const bx = this.foodOrigin.x + this.food.biteFront.x - x;
    const bz = this.foodOrigin.z + this.food.biteFront.z - z;
    this.heading = Math.hypot(bx, bz) > 1e-4 ? Math.atan2(bx, bz) : this.heading;
    this.mode = 'onFood';
    this.onWall = false;
    this.glueIndex = chunk.index;
    this.syncFlightWorld();
    this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
    if (opts.taste) this.fsm.beginTaste(this.heading);
    else this.fsm.reset(this.heading);
  }

  private placeOnFoodSide(opts: { taste: boolean }): void {
    const xz = this.sideStandPoint();
    this.position.set(xz.x, this.surfaceYAt(xz.x, xz.z), xz.z);
    const ap = this.food.approachTarget(
      { x: this.position.x, y: this.position.y, z: this.position.z },
      this.foodOrigin,
    );
    this.heading = ap.yaw;
    this.mode = 'ground';
    this.onWall = false;
    this.syncFlightWorld();
    this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
    if (opts.taste) this.fsm.beginTaste(this.heading);
    else this.fsm.reset(this.heading);
  }

  private resolveGlueChunk(): ChunkRecord | null {
    if (this.glueIndex != null) {
      const held = this.food.chunks[this.glueIndex];
      if (held && !held.eaten) return held;
    }
    const lx = this.position.x - this.foodOrigin.x;
    const lz = this.position.z - this.foodOrigin.z;
    let best: ChunkRecord | null = null;
    let bestD = Infinity;
    for (const c of this.food.chunks) {
      if (c.eaten) continue;
      const d = Math.hypot(c.centroid.x - lx, c.centroid.z - lz);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    this.glueIndex = best?.index ?? null;
    return best;
  }

  /** Keep TASTE / EXTEND / PUMP within one body length of the current bite. */
  private glueToFood(): void {
    const s = this.fsm.state;
    if (s !== 'TASTE' && s !== 'EXTEND' && s !== 'PUMP') {
      this.glueIndex = null;
      return;
    }
    if (!isEatState(this.loop.state)) return;
    const chunk = this.resolveGlueChunk();
    if (!chunk) return;
    const max = flyVisualLengthMm();
    if (this.mode === 'onFood') {
      const tx = this.foodOrigin.x + chunk.centroid.x;
      const tz = this.foodOrigin.z + chunk.centroid.z;
      const dx = this.position.x - tx;
      const dz = this.position.z - tz;
      const dist = Math.hypot(dx, dz);
      if (dist > max && dist > 1e-6) {
        this.position.x = tx + dx * (max / dist);
        this.position.z = tz + dz * (max / dist);
      }
      return;
    }
    const ap = this.food.approachTarget(
      { x: this.position.x, y: this.position.y, z: this.position.z },
      this.foodOrigin,
    );
    const dx = this.position.x - ap.point.x;
    const dz = this.position.z - ap.point.z;
    const dist = Math.hypot(dx, dz);
    if (dist > max && dist > 1e-6) {
      this.position.x = ap.point.x + dx * (max / dist);
      this.position.z = ap.point.z + dz * (max / dist);
    }
  }

  private surfaceYAt(x: number, z: number): number {
    return this.food.supportHeightAt(x, z, this.foodOrigin) + this.standOffset;
  }

  private surfaceY(): number {
    if (this.onWall) return this.position.y;
    return this.surfaceYAt(this.position.x, this.position.z);
  }

  private foodAabb3(): Aabb3 {
    return {
      cx: this.foodOrigin.x,
      cy: this.foodOrigin.y,
      cz: this.foodOrigin.z,
      hx: this.food.hx,
      hy: this.food.hy,
      hz: this.food.hz,
    };
  }

  private tableAabb3(): Aabb3 {
    const { table } = kitchenLayout();
    return {
      cx: 0,
      cy: -TABLE_THICKNESS_MM / 2,
      cz: 0,
      hx: table.width / 2,
      hy: TABLE_THICKNESS_MM / 2,
      hz: table.depth / 2,
    };
  }

  private boardObb3(): Obb3 {
    const { board } = kitchenLayout();
    return {
      cx: board.x,
      cy: board.y,
      cz: board.z,
      hx: board.hx,
      hy: board.hy,
      hz: board.hz,
      yaw: board.yaw,
    };
  }

  private pouchObb3(): Obb3 {
    return {
      cx: this.pouch.cx,
      cy: boardTopY() + POUCH_BASE_HEIGHT_MM / 2,
      cz: this.pouch.cz,
      hx: this.pouch.hx,
      hy: POUCH_BASE_HEIGHT_MM / 2,
      hz: this.pouch.hz,
      yaw: this.pouch.yaw,
    };
  }

  /** The chunk being pumped, as a shrinking morsel in the forelegs (PUMP only). */
  private heldCrumb(): DirectorOutput['heldCrumb'] {
    if (this.fsm.state !== 'PUMP' || this.refillClip) return null;
    const idx = this.food.consumingIndex();
    if (idx === null) return null;
    return { progress: this.food.consumeProgress(idx), chunkIndex: idx };
  }

  /** Solids and the 200 ms lookahead segment, for the `?debug=flight` overlay. */
  debugSolids(): {
    aabbs: Aabb3[];
    obbs: Obb3[];
    lookahead: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } };
    flightHits: number;
  } {
    const from = { x: this.position.x, y: this.position.y, z: this.position.z };
    return {
      aabbs: [this.foodAabb3(), this.tableAabb3()],
      obbs: [this.pouchObb3(), this.boardObb3()],
      lookahead: {
        from,
        to: {
          x: from.x + this.velocity.x * LOOKAHEAD_S,
          y: from.y + this.velocity.y * LOOKAHEAD_S,
          z: from.z + this.velocity.z * LOOKAHEAD_S,
        },
      },
      flightHits: this.flight.hitCount,
    };
  }

  private syncFlightWorld(): void {
    this.flight.setWorld({
      obstacles: [this.foodAabb3(), this.tableAabb3()],
      obbs: [this.pouchObb3(), this.boardObb3()],
      floorY: this.food.supportHeightAt(this.position.x, this.position.z, this.foodOrigin),
      ceilingY: FLIGHT_CEILING_MM,
    });
  }

  private surfaceNormal(): { x: number; y: number; z: number } {
    if (this.onWall) {
      const p = this.food.projectOntoVerticalFace(
        { x: this.position.x, y: this.position.y, z: this.position.z },
        this.foodOrigin,
        0,
      );
      return { x: p.nx, y: 0, z: p.nz };
    }
    return { x: 0, y: 1, z: 0 };
  }

  private applyStandingY(dt: number): void {
    if (this.mode === 'flight' || this.onWall) return;
    const target = this.surfaceY();
    if (this.mode === 'onFood') {
      this.position.y = target;
      this.stepping = false;
      return;
    }
    const delta = target - this.position.y;
    if (!this.stepping && Math.abs(delta) > 1.5) {
      this.stepping = true;
      this.stepT = 0;
      this.stepFromY = this.position.y;
      this.stepToY = target;
    }
    if (this.stepping) {
      this.stepToY = target;
      this.stepT += dt;
      const u = clamp01(this.stepT / BOARD_STEP_S);
      const hop = Math.sin(u * Math.PI) * BOARD_STEP_HOP_MM;
      this.position.y = lerp(this.stepFromY, this.stepToY, easeInOut(u)) + hop;
      if (u >= 1) {
        this.stepping = false;
        this.position.y = this.stepToY;
      }
    } else {
      this.position.y = target;
    }
  }

  private applyConstraints(dt: number): void {
    this.syncFlightWorld();
    if (this.mode === 'onFood') {
      if (this.onWall) {
        const p = this.food.projectOntoVerticalFace(
          { x: this.position.x, y: this.position.y, z: this.position.z },
          this.foodOrigin,
          bodyCollisionPadMm() * 0.15,
        );
        this.position.x = p.x;
        this.position.z = p.z;
      }
    } else if (this.mode === 'ground') {
      const padded = this.food.clampRoot(
        { x: this.position.x, y: this.position.y, z: this.position.z },
        this.foodOrigin,
      );
      const packPos = clampOutsideXzObb(padded, this.pouch, bodyCollisionPadMm());
      this.position.x = packPos.x;
      this.position.z = packPos.z;
    }

    // In flight the FlightController already resolved solids (with face
    // hysteresis) inside `update()`; resolving again here with a different
    // face choice produced edge chatter. Ground / onFood still resolve here.
    if (this.mode !== 'flight') {
      const skipBoard = this.stepping && this.stepToY > this.stepFromY;
      const aabbs = this.mode === 'onFood' ? [this.tableAabb3()] : [this.foodAabb3(), this.tableAabb3()];
      const obbs = skipBoard
        ? [this.pouchObb3()]
        : [this.pouchObb3(), this.boardObb3()];
      const resolved = resolveSolids(
        { x: this.position.x, y: this.position.y, z: this.position.z },
        { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
        aabbs,
        obbs,
      );
      this.position.set(resolved.position.x, resolved.position.y, resolved.position.z);
      this.velocity.set(resolved.velocity.x, resolved.velocity.y, resolved.velocity.z);
    }

    if (this.mode === 'flight') {
      const floor = this.food.supportHeightAt(this.position.x, this.position.z, this.foodOrigin);
      this.position.y = clamp(this.position.y, floor, FLIGHT_CEILING_MM);
    } else {
      this.applyStandingY(dt);
    }

    if (this.flight.kind !== 'takeoff2') {
      const next = slerpTowardUpCone(
        this.pitch,
        this.heading,
        this.bank + this.roll,
        this.surfaceNormal(),
        dt,
      );
      this.pitch = next.pitch;
      this.roll = next.roll - this.bank;
    }

    if (this.mode === 'flight') {
      this.flight.position = { x: this.position.x, y: this.position.y, z: this.position.z };
      this.flight.velocity = { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z };
      this.flight.heading = this.heading;
      this.flight.pitch = this.pitch;
      this.flight.bank = this.bank;
      this.flight.roll = this.roll;
    }
  }

  private updateFeeding(input: DirectorInput, kind: 'top' | 'side'): {
    pose: Pose;
    walk: number;
    pumpAmplitude: number;
    events: FeedingEvent[];
  } {
    const dt = input.dt;
    const foodXZ = { x: this.foodOrigin.x, z: this.foodOrigin.z };
    const posXZ = { x: this.position.x, z: this.position.z };
    const approach = this.food.approachTarget(
      { x: this.position.x, y: this.position.y, z: this.position.z },
      this.foodOrigin,
    );
    const events: FeedingEvent[] = [];
    let walk = 0;
    let pumpAmplitude = 0;
    let pose: Pose;
    // Top landing: she is already on the food. Do not skip TASTE — only skip the walk.
    const distance = kind === 'top' ? Math.min(approach.distance, 0.4) : approach.distance;

    if (this.refillClip) {
      this.refillHold += dt;
      pose = this.mixer.update(dt);
      if (this.refillHold >= CLIP_DURATION[this.refillClip]) {
        if (this.refillClip === 'retract') {
          this.refillClip = 'groom';
          this.refillHold = 0;
          this.mixer.play('groom', { restart: true, fade: 0.08 });
          this.hudState = 'REST';
        } else {
          this.refillClip = null;
          this.refillHold = 0;
          this.fsm.reset(this.fsm.heading);
          this.hudState = this.fsm.state;
        }
      }
      this.heading = this.fsm.heading;
      this.velocity.set(0, 0, 0);
    } else {
      const output = this.fsm.step({
        dt,
        mn9Rate: input.mn9Rate,
        bitter: input.bitter,
        satiety: input.satiety,
        odorYaw: odorGradientYaw(posXZ, foodXZ),
        approachYaw: approach.yaw,
        odorStrength: odorConcentration(posXZ, foodXZ, input.odor),
        distanceToFood: distance,
      });
      this.mixer.setAmplitude(output.pumpAmplitude);
      this.mixer.play(output.clip);
      pose = this.mixer.update(dt);
      this.heading = output.heading;
      walk = output.walk;
      pumpAmplitude = output.pumpAmplitude;
      this.hudState = output.state;
      events.push(...output.events);
      if (output.walk > 0 && kind !== 'top') {
        this.velocity.set(
          Math.sin(output.heading) * FLY_WALK_MM_S,
          0,
          Math.cos(output.heading) * FLY_WALK_MM_S,
        );
        this.position.x += this.velocity.x * dt;
        this.position.z += this.velocity.z * dt;
      } else {
        this.velocity.set(0, 0, 0);
      }
      if (kind === 'top') {
        this.mode = 'onFood';
        this.onWall = false;
      }
    }
    this.glueToFood();
    this.forelegExtend = 0;
    if (!this.onWall) this.pitch = 0;
    return { pose, walk, pumpAmplitude, events };
  }

  private stepFood(input: DirectorInput, pose: Pose, pumping: boolean) {
    const foodXZ = { x: this.foodOrigin.x, z: this.foodOrigin.z };
    const posXZ = { x: this.position.x, z: this.position.z };
    const flyLocal = {
      x: this.position.x - this.foodOrigin.x,
      y: this.position.y - this.foodOrigin.y,
      z: this.position.z - this.foodOrigin.z,
    };
    this.food.followBiteFront(flyLocal);
    const topY = this.mode === 'onFood' && !this.onWall
      ? this.food.supportHeightAt(this.position.x, this.position.z, this.foodOrigin)
      : undefined;
    const contacts = this.sampleContacts?.({
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      heading: this.heading,
      pose,
    }) ?? kinematicContacts(this.position, this.heading, this.foodOrigin, topY);
    return this.food.step({
      dt: input.dt,
      pumping,
      tasting: this.fsm.state === 'TASTE' || this.fsm.state === 'EXTEND' || this.fsm.state === 'PUMP',
      labellum: contacts.labellum,
      cameraDist: input.cameraDist,
      sensors: contacts.sensors,
      profile: TWAROG_MAMUTA_WANILIOWY,
      foodXZ,
      flyXZ: posXZ,
    });
  }

  private collectFood(
    foodEvents: ReturnType<TwarogSystem['step']>['events'],
    events: FeedingEvent[],
  ): { crumbs: ConsumeEvent[]; portions: number | null } {
    const crumbs: ConsumeEvent[] = [];
    let portions: number | null = null;
    for (const ev of foodEvents) {
      if (ev.type === 'consume') {
        crumbs.push(ev);
        events.push({
          type: 'consume',
          massGrams: ev.massGrams,
          chunkId: ev.index,
          centroid: ev.centroid,
          t: this.fsm.time,
        });
      } else if (ev.type === 'groom') {
        this.refillClip = 'retract';
        this.refillHold = 0;
        this.mixer.play('retract', { restart: true, fade: 0.1 });
        this.hudState = 'RETRACT';
      } else if (ev.type === 'refill') {
        events.push({ type: 'portion', count: ev.portion, t: this.fsm.time });
        portions = ev.portion;
      }
    }
    return { crumbs, portions };
  }

  private applyGait(pose: Pose, walking: boolean, dt: number): Pose {
    const step = Math.hypot(this.position.x - this.lastX, this.position.z - this.lastZ);
    const yawRate = dt > 1e-8 ? headingError(this.lastHeading, this.heading) / dt : 0;
    let next = pose;
    if (walking && this.mode !== 'flight' && dt > 1e-8 && step > 0.02) {
      this.gaitDistance += step;
      next = replaceEuler(next, gaitPoseAtDistance(this.gaitDistance, step / dt, yawRate));
    }
    this.lastX = this.position.x;
    this.lastZ = this.position.z;
    this.lastHeading = this.heading;
    this.simTime += Math.max(0, dt);
    return next;
  }

  private applyGroundWings(idleFlick: boolean): void {
    if (this.mode === 'flight') return;
    const flick = idleFlick ? wingIdleFlick(this.simTime, this.seed) : { flickL: 0, flickR: 0 };
    this.wingRaiseL = 0;
    this.wingRaiseR = 0;
    this.wingSongL = 0;
    this.wingSongR = 0;
    this.wingBlurL = 0;
    this.wingBlurR = 0;
    this.wingFlicker = 0;
    this.wingFlickL = flick.flickL;
    this.wingFlickR = flick.flickR;
  }

  private packOutput(
    pose: Pose,
    pumpAmplitude: number,
    walk: number,
    events: FeedingEvent[],
    chemo: ChemoSample | null,
    portions: number | null,
    crumbs: ConsumeEvent[],
    cropVolume: number,
  ): DirectorOutput {
    return {
      flyPose: {
        position: this.position,
        heading: this.heading,
        pitch: this.pitch,
        bank: this.bank,
        roll: this.roll,
        clipName: this.mixer.clip.name,
        clipTime: this.mixer.time,
        pumpAmplitude,
        pose,
        abdomenScale: 1 + 0.25 * cropVolume,
        wingRaiseL: this.wingRaiseL,
        wingRaiseR: this.wingRaiseR,
        wingSongL: this.wingSongL,
        wingSongR: this.wingSongR,
        wingBlurAlphaL: this.wingBlurL,
        wingBlurAlphaR: this.wingBlurR,
        wingFlicker: this.wingFlicker,
        wingFlickL: this.wingFlickL,
        wingFlickR: this.wingFlickR,
        forelegExtend: this.forelegExtend,
      },
      cameraAim: {
        x: this.position.x * 0.82 + this.foodOrigin.x * 0.18,
        y: this.position.y,
        z: this.position.z * 0.82 + this.foodOrigin.z * 0.18,
      },
      events,
      chemo,
      state: this.fsm.state,
      hudState: this.hudState,
      mode: this.mode,
      walk,
      portions,
      crumbs,
      caption: this.caption,
      macro: this.scriptedLoop ? this.loop.state : 'GROUND',
      gag: this.scriptedLoop ? this.loop.gag : null,
      spoonShadow: this.spoonShadow,
      crumbAttach: this.crumbAttach,
      heldCrumb: this.heldCrumb(),
      bites: this.fsm.pumpCycles,
      bitesTarget: this.fsm.pumpTarget,
      // Normalised to the portion as served (opening bite already taken), so
      // "ZOSTAŁO %" starts at 100 and grams eaten start at 0.
      remainingFrac: this.food.portionMassGrams > 0
        ? this.food.remainingMassGrams / this.food.portionMassGrams
        : 0,
      portionCount: this.food.portionCount,
      gramsEaten: Math.max(0, this.food.portionMassGrams - this.food.remainingMassGrams),
      loopWrapped: this.loopWrapped,
    };
  }

  private updateLegacyGround(input: DirectorInput): DirectorOutput {
    const dt = input.dt;
    this.loopWrapped = false;
    const foodXZ = { x: this.foodOrigin.x, z: this.foodOrigin.z };
    const posXZ = { x: this.position.x, z: this.position.z };
    const approach = this.food.approachTarget(
      { x: this.position.x, y: this.position.y, z: this.position.z },
      this.foodOrigin,
    );
    const events: FeedingEvent[] = [];
    let walk = 0;
    let pumpAmplitude = 0;
    let pose: Pose;

    if (this.refillClip) {
      this.refillHold += dt;
      pose = this.mixer.update(dt);
      if (this.refillHold >= CLIP_DURATION[this.refillClip]) {
        if (this.refillClip === 'retract') {
          this.refillClip = 'groom';
          this.refillHold = 0;
          this.mixer.play('groom', { restart: true, fade: 0.08 });
          this.hudState = 'REST';
        } else {
          this.refillClip = null;
          this.refillHold = 0;
          this.fsm.reset(this.fsm.heading);
          this.hudState = this.fsm.state;
        }
      }
      this.heading = this.fsm.heading;
      this.velocity.set(0, 0, 0);
    } else {
      const output = this.fsm.step({
        dt,
        mn9Rate: input.mn9Rate,
        bitter: input.bitter,
        satiety: input.satiety,
        odorYaw: odorGradientYaw(posXZ, foodXZ),
        approachYaw: approach.yaw,
        odorStrength: odorConcentration(posXZ, foodXZ, input.odor),
        distanceToFood: approach.distance,
      });
      this.mixer.setAmplitude(output.pumpAmplitude);
      this.mixer.play(output.clip);
      pose = this.mixer.update(dt);
      this.heading = output.heading;
      walk = output.walk;
      pumpAmplitude = output.pumpAmplitude;
      this.hudState = output.state;
      events.push(...output.events);
      if (output.walk > 0) {
        this.velocity.set(
          Math.sin(output.heading) * FLY_WALK_MM_S,
          0,
          Math.cos(output.heading) * FLY_WALK_MM_S,
        );
        this.position.x += this.velocity.x * dt;
        this.position.z += this.velocity.z * dt;
      } else {
        this.velocity.set(0, 0, 0);
      }
    }

    const padded = this.food.clampRoot(
      { x: this.position.x, y: this.position.y, z: this.position.z },
      this.foodOrigin,
    );
    const packPos = clampOutsideXzObb(padded, this.pouch, bodyCollisionPadMm());
    this.position.x = packPos.x;
    this.position.z = packPos.z;
    this.mode = 'ground';
    this.applyConstraints(dt);
    pose = this.applyGait(pose, walk > 0 && !this.refillClip, dt);
    this.applyGroundWings(walk <= 0 && !this.refillClip);

    const flyLocal = {
      x: this.position.x - this.foodOrigin.x,
      y: this.position.y - this.foodOrigin.y,
      z: this.position.z - this.foodOrigin.z,
    };
    this.food.followBiteFront(flyLocal);
    const contacts = this.sampleContacts?.({
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      heading: this.heading,
      pose,
    }) ?? kinematicContacts(this.position, this.heading, this.foodOrigin);
    const foodOut = this.food.step({
      dt,
      pumping: !this.refillClip && this.fsm.state === 'PUMP',
      tasting: this.fsm.state === 'TASTE' || this.fsm.state === 'EXTEND' || this.fsm.state === 'PUMP',
      labellum: contacts.labellum,
      cameraDist: input.cameraDist,
      sensors: contacts.sensors,
      profile: TWAROG_MAMUTA_WANILIOWY,
      foodXZ,
      flyXZ: posXZ,
    });
    const { crumbs, portions } = this.collectFood(foodOut.events, events);
    return this.packOutput(pose, pumpAmplitude, walk, events, foodOut.chemo, portions, crumbs, input.cropVolume ?? 0);
  }
}
