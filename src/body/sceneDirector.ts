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
import { CreatineSystem, type ScoopMode } from '../food/creatineSystem.ts';
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
  EXTENDED_TIP_NATIVE,
  FLY_RENDER_SCALE,
  FLY_WALK_MM_S,
  MILL_WALK_MM_S,
  REST_TIP_NATIVE,
  SCOOP_MM,
  bodyCollisionPadMm,
  flyVisualLengthMm,
  foodStandPadMm,
  mm,
  powderLandingYMm,
  standoffMm,
  tableTopY,
} from '../scene/scale.ts';
import { BIPED_BODY_PITCH_RAD, bipedPoseAtDistance, bipedStandLiftMm, BIPED_WALK_S, MILL_WALK_S } from './bipedGait.ts';
import { SCOOP_DIP_S, SCOOP_DROP_S, SCOOP_PICK_S } from './scoop.ts';
import { WALL_FEED_TAU_S, pitchedLabellumLocal, wallFeedLiftMm, wallFeedPitch } from './wallFeed.ts';
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
  FLY_INTO_TUB_S,
  FLY_OUT_SCOOP_S,
  MILL_LAND_HEX_S,
  EAT_SCOOP_MAX_BITES,
  EAT_SCOOP_MIN_BITES,
  isEatState,
  isFlightState,
  isSplineFlight,
  isWalkState,
  type LoopState,
  type LoopVariant,
} from './sceneLoop.ts';
import { kitchenLayout, scoopEatStand, scoopTableStand } from '../scene/layout.ts';
import { headingError, clamp, clamp01, easeInOut, lerp } from './math.ts';
import { gaitPoseAtDistance, millGaitAdvance } from './gait.ts';
import { wingIdleFlick } from './wings.ts';
import { millStandXz, millSurfaceY, MILL_HEADING } from './treadmill.ts';
import { LOOP_CAPTIONS_PL } from '../hud/captions.ts';

export type LocomotionMode = 'ground' | 'flight' | 'onFood' | 'mill';

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
  /** Authored hemolymph hunger. AUTONOMOUS roam reads this; never writes ActivityFrame. */
  hungerDrive?: number;
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
  scoop: { mode: ScoopMode; fill: number; dipU: number } | null;
  bites: number;
  bitesTarget: number;
  remainingFrac: number;
  portionCount: number;
  gramsEaten: number;
  loopWrapped: boolean;
  /** Authored mill console: millimetres walked this session (belt gait, not root ΔXZ). */
  millDistanceMm: number;
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

/**
 * Rig-less labellum estimate (tests, worker-only builds): the MEASURED rest /
 * extended tip (scale.ts) rotated by the body pitch and pushed along the
 * heading. `sensorY` overrides the height (top feeding: the surface).
 */
function kinematicContacts(
  position: Vec3,
  heading: number,
  foodOrigin: Vec3,
  opts: { pitch?: number; extended?: boolean; sensorY?: number } = {},
): ContactSample {
  const tip = pitchedLabellumLocal(
    FLY_RENDER_SCALE,
    opts.pitch ?? 0,
    !!opts.extended,
    REST_TIP_NATIVE,
    EXTENDED_TIP_NATIVE,
  );
  const y = opts.sensorY ?? position.y + tip.y;
  const labW = {
    x: position.x + Math.sin(heading) * tip.z,
    y,
    z: position.z + Math.cos(heading) * tip.z,
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
  private lastLoop: LoopState = 'FLY_INTO_TUB';
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
  /** 0 → 1 while feeding at a vertical face from the board (authored posture, wallFeed.ts). */
  private wallFeedU = 0;
  /** Last labellum / sensor sample handed to the food (food-local). */
  private contacts: ContactSample = { labellum: { x: 0, y: 0, z: 0 }, sensors: [] };

  /** Last contact sample (food-local millimetres). Observation only; tests and debug. */
  lastContacts(): ContactSample {
    return this.contacts;
  }
  private caption = '';
  private spoonShadow = 0;
  private crumbAttach: CrumbBone = null;
  private onWall = false;
  private napDoubled = false;
  private simTime = 0;
  private gaitDistance = 0;
  private millSessionMm = 0;
  private lastX = 0;
  private lastZ = 0;
  private lastHeading = 0;
  private standOffset = 2;
  private stepping = false;
  private stepT = 0;
  private stepFromY = 0;
  private stepToY = 0;
  private propT = 0;
  private autoKind: 'choose' | 'flyIn' | 'pick' | 'flyOut' | 'eat' | 'groom' | 'rest' | 'roam' = 'choose';

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
    this.sampleContacts = deps.sampleContacts;
    this.scriptedLoop = !!deps.scriptedLoop;
    this.loopVariant = deps.loopVariant ?? 'reel';
    this.fsm = new FeedingStateMachine({ heading: this.spawnHeading });
    this.fsm.fastConsume = this.scriptedLoop;
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
    this.fsm.fastConsume = this.scriptedLoop;
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
    this.millSessionMm = 0;
    this.lastX = this.position.x;
    this.lastZ = this.position.z;
    this.lastHeading = this.heading;
    this.stepping = false;
    this.stepT = 0;
    this.propT = 0;
    this.autoKind = 'choose';
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
    this.propT = 0;
    this.onWall = false;
    this.caption = '';
    this.spoonShadow = 0;
    this.crumbAttach = null;
    this.napDoubled = false;
    const food = this.foodOrigin;
    const layout = kitchenLayout();
    this.syncFlightWorld();
    if (state === 'ORBIT' || state === 'ORBIT_SHORT') {
      this.mode = 'flight';
      this.flight.place({ x: this.position.x, y: Math.max(this.position.y, tableTopY() + 18), z: this.position.z }, this.heading);
      this.flight.startOrbit({
        target: food,
        circuits: state === 'ORBIT_SHORT' ? 1 : this.loop.orbitCircuits,
        descend: state === 'ORBIT',
        seed: this.seed + (state === 'ORBIT_SHORT' ? 3 : 0),
      });
    } else if (state === 'LAND_TOP') {
      this.mode = 'flight';
      const xz = { x: layout.scoop.x, z: layout.scoop.z };
      const support = this.surfaceYAt(xz.x, xz.z);
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startLand({ target: { x: xz.x, y: support, z: xz.z }, supportY: support, seed: this.seed + 5 });
    } else if (state === 'LAND_MILL') {
      this.mode = 'flight';
      const stand = millStandXz();
      const support = millSurfaceY(stand.x) + this.standOffset;
      const target = { x: stand.x, y: support, z: stand.z };
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startLand({ target, supportY: support, seed: this.seed + 7 });
    } else if (state === 'TAKEOFF_MILL' || state === 'TAKEOFF_EXIT') {
      this.mode = 'flight';
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startTakeoff1();
    } else if (state === 'EXIT_FRAME') {
      this.mode = 'flight';
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startExit(this.heading);
    } else if (state === 'FLY_INTO_TUB') {
      this.startFlyIntoTub();
    } else if (state === 'FLY_OUT_WITH_SCOOP') {
      this.startFlyOutWithScoop();
    } else if (state === 'WALK_SCOOP') {
      this.mode = 'ground';
      this.walkGoal = { x: layout.scoop.x, z: layout.scoop.z };
      this.creatine()?.resetScoop();
    } else if (state === 'PICK_SCOOP') {
      this.mode = 'flight';
      this.creatine()?.pick();
    } else if (state === 'APPROACH_TUB') {
      this.mode = 'ground';
      this.walkGoal = this.eatStandPoint();
    } else if (state === 'DIP_SCOOP') {
      this.mode = 'ground';
      this.creatine()?.dip();
    } else if (state === 'EAT_SCOOP') {
      this.mixer.play('odorTrack', { fade: 0, restart: true });
      this.placeAtTableStand({ taste: true });
    } else if (state === 'DROP_SCOOP') {
      this.mode = 'ground';
      this.creatine()?.drop();
      const table = scoopTableStand();
      this.walkGoal = { x: table.x, z: table.z };
    } else if (state === 'WALK_MILL' || state === 'WALK_BIPED' || state === 'WALK_BIPED_ON_MILL') {
      this.lockMillStand(state !== 'WALK_MILL');
    } else if (state === 'AUTONOMOUS') {
      this.autoKind = 'choose';
      this.mode = 'ground';
      this.creatine()?.drop();
    } else if (state === 'NAP' || state === 'WAKE' || state === 'GROOM_SHORT' || state === 'GROOM_FULL') {
      this.mode = this.overFood() ? 'onFood' : this.mode === 'mill' ? 'mill' : 'ground';
      if (state === 'NAP' && this.mode === 'ground') this.placeAtPile({ taste: false });
    }
  }

  private lockMillStand(biped: boolean): void {
    const stand = millStandXz();
    this.mode = 'mill';
    this.position.set(stand.x, millSurfaceY(stand.x) + this.standOffset + (biped ? bipedStandLiftMm() : 0), stand.z);
    this.heading = MILL_HEADING;
    this.pitch = biped ? BIPED_BODY_PITCH_RAD : 0;
    this.bank = 0;
    this.roll = 0;
    this.syncFlightWorld();
  }

  private ensureWellScoop(): void {
    const c = this.creatine();
    if (!c) return;
    if (c.scoopMode !== 'well' || c.scoopFill <= 0) {
      c.resetScoop();
      c.fillWell();
    }
  }

  private flyIntoTubPoints(): Vec3[] {
    const layout = kitchenLayout();
    const stand = scoopEatStand();
    const rimY = tableTopY() + layout.tub.height + 10;
    const wellY = powderLandingYMm() + this.standOffset;
    return [
      { x: this.position.x, y: Math.max(this.position.y, tableTopY() + 16), z: this.position.z },
      { x: layout.tub.x, y: rimY, z: layout.tub.z - layout.tub.diameter * 0.2 },
      { x: layout.tub.x, y: rimY + 2, z: layout.tub.z },
      { x: stand.x, y: wellY, z: stand.z },
    ];
  }

  private startFlyIntoTub(): void {
    this.mode = 'flight';
    this.ensureWellScoop();
    this.flight.place(
      { x: this.position.x, y: Math.max(this.position.y, tableTopY() + 16), z: this.position.z },
      this.heading,
    );
    this.flight.startSpline({
      points: this.flyIntoTubPoints(),
      duration: FLY_INTO_TUB_S,
      endHeading: scoopEatStand().heading,
    });
  }

  private startFlyOutWithScoop(): void {
    this.mode = 'flight';
    const stand = scoopTableStand();
    const layout = kitchenLayout();
    const rimY = tableTopY() + layout.tub.height;
    const apexY = rimY + mm(SCOOP_MM.handleLength) + mm(SCOOP_MM.bowlRadius) + 10;
    const landY = tableTopY() + this.standOffset;
    this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
    this.flight.startSpline({
      points: [
        { x: this.position.x, y: this.position.y, z: this.position.z },
        { x: this.position.x, y: apexY, z: this.position.z },
        { x: (this.position.x + stand.x) * 0.5, y: apexY, z: (this.position.z + stand.z) * 0.5 },
        { x: stand.x, y: apexY, z: stand.z },
        { x: stand.x, y: landY, z: stand.z },
      ],
      duration: FLY_OUT_SCOOP_S,
      endHeading: stand.heading,
    });
  }

  private inTubGhost(): boolean {
    return isSplineFlight(this.loop.state)
      || this.loop.state === 'PICK_SCOOP'
      || this.autoKind === 'flyIn'
      || this.autoKind === 'pick'
      || this.autoKind === 'flyOut'
      || this.autoKind === 'eat';
  }

  private isBipedMill(): boolean {
    return this.loop.state === 'WALK_BIPED_ON_MILL' || this.loop.state === 'WALK_BIPED';
  }

  private applyFlightFrame(dt: number): Pose {
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
    const pose = overlayEuler(this.mixer.update(dt), {
      foreleg_L_tarsus: [55 * frame.forelegExtend, 0, 18 * frame.forelegExtend],
      foreleg_R_tarsus: [55 * frame.forelegExtend, 0, -18 * frame.forelegExtend],
    });
    return this.applyGait(pose, false, dt);
  }

  private stepAutonomousFlags(dt: number, input: DirectorInput): void {
    const hunger = input.hungerDrive ?? 0.5;
    if (this.autoKind === 'choose') {
      this.eatSawRest = false;
      this.eatSatietyRetract = false;
      if (hunger >= 0.48 || input.satiety < 0.35) {
        this.autoKind = 'flyIn';
        this.startFlyIntoTub();
      } else if (input.satiety >= 0.55) {
        this.autoKind = 'groom';
        this.groomT = 0;
        this.mode = 'ground';
      } else {
        this.autoKind = 'roam';
        this.mode = 'ground';
        const stand = scoopEatStand();
        this.walkGoal = { x: stand.x + 18, z: stand.z };
      }
      return;
    }
    if (this.autoKind === 'flyIn' && this.flight.done) {
      this.creatine()?.pick();
      this.autoKind = 'pick';
      this.propT = 0;
    } else if (this.autoKind === 'pick') {
      this.propT += dt;
      if (this.propT >= SCOOP_PICK_S) {
        this.autoKind = 'eat';
        this.mixer.play('odorTrack', { fade: 0, restart: true });
        this.placeAtPile({ taste: true });
      }
    } else if (this.autoKind === 'eat') {
      if (this.eatSatietyRetract || (this.eatSawRest && this.fsm.state === 'SEARCH')) {
        this.creatine()?.drop();
        this.autoKind = 'choose';
      }
    } else if (this.autoKind === 'groom') {
      this.groomT += dt;
      if (this.groomT >= GROOM_SHORT_S) {
        this.autoKind = 'rest';
        this.napT = 0;
      }
    } else if (this.autoKind === 'rest') {
      this.napT += dt;
      if (this.napT >= 3.5) this.autoKind = 'choose';
    } else if (this.autoKind === 'roam') {
      if (this.stepWalkGoal(dt)) this.autoKind = 'choose';
    }
  }

  private updateAutonomous(input: DirectorInput): {
    pose: Pose;
    walk: number;
    pumpAmplitude: number;
    events: FeedingEvent[];
  } {
    const dt = input.dt;
    if (this.autoKind === 'pick') {
      this.mixer.play('approach');
      let pose = overlayEuler(this.mixer.update(dt), {
        foreleg_L_tarsus: [48, 8, 22],
        foreleg_R_tarsus: [52, -10, -28],
      });
      this.forelegExtend = 0.72;
      this.hudState = 'APPROACH';
      this.caption = LOOP_CAPTIONS_PL.PICK_SCOOP;
      this.wingRaiseL = 0;
      this.wingRaiseR = 0;
      pose = this.applyGait(pose, false, dt);
      return { pose, walk: 0, pumpAmplitude: 0, events: [] };
    }
    if (this.autoKind === 'eat') {
      this.caption = LOOP_CAPTIONS_PL.EAT_SCOOP;
      return this.updateFeeding(input, 'scoop');
    }
    if (this.autoKind === 'groom') {
      this.mixer.play('groom');
      let pose = applyGroomNap(this.mixer.update(dt), groomShortOverlay(this.groomT));
      this.caption = LOOP_CAPTIONS_PL.GROOM_SHORT;
      this.hudState = 'REST';
      pose = this.applyGait(pose, false, dt);
      this.applyGroundWings(false);
      return { pose, walk: 0, pumpAmplitude: 0, events: [] };
    }
    if (this.autoKind === 'rest') {
      this.mixer.play('idle');
      let pose = applyGroomNap(this.mixer.update(dt), napOverlay(this.napT, input.satiety, false));
      this.caption = LOOP_CAPTIONS_PL.NAP;
      this.hudState = 'REST';
      pose = this.applyGait(pose, false, dt);
      this.applyGroundWings(true);
      return { pose, walk: 0, pumpAmplitude: 0, events: [] };
    }
    this.mixer.play('approach');
    this.caption = LOOP_CAPTIONS_PL.AUTONOMOUS;
    this.hudState = 'SEARCH';
    this.mode = 'ground';
    let pose = this.applyGait(this.mixer.update(dt), true, dt);
    this.applyGroundWings(false);
    return { pose, walk: 1, pumpAmplitude: 0, events: [] };
  }

  private creatine(): CreatineSystem | null {
    return this.food instanceof CreatineSystem ? this.food : null;
  }

  private pileStandPoint(): { x: number; z: number } {
    const probe = {
      x: this.foodOrigin.x,
      y: this.foodOrigin.y,
      z: this.foodOrigin.z - this.food.hz - standoffMm() - 8,
    };
    const ap = this.food.approachTarget(probe, this.foodOrigin);
    return { x: ap.point.x, z: ap.point.z };
  }

  private eatStandPoint(): { x: number; z: number } {
    if (this.creatine()) {
      const stand = scoopEatStand();
      return { x: stand.x, z: stand.z };
    }
    return this.pileStandPoint();
  }

  private eatStandHeading(): number {
    if (this.creatine()) {
      if (this.scriptedLoop && this.loop.state === 'EAT_SCOOP') return scoopTableStand().heading;
      return scoopEatStand().heading;
    }
    const xz = this.pileStandPoint();
    return this.food.approachTarget(
      { x: xz.x, y: this.surfaceYAt(xz.x, xz.z), z: xz.z },
      this.foodOrigin,
    ).yaw;
  }

  private eatScoopDone(): boolean {
    const bites = this.fsm.pumpCycles;
    const biteCap = bites >= EAT_SCOOP_MIN_BITES && bites >= EAT_SCOOP_MAX_BITES;
    if (this.loopVariant === 'full') {
      return biteCap || this.eatSatietyRetract || (this.eatSawRest && this.fsm.state === 'SEARCH');
    }
    return biteCap || this.eatSatietyRetract;
  }

  private placeAtTableStand(opts: { taste: boolean }): void {
    const stand = scoopTableStand();
    this.position.set(stand.x, tableTopY() + this.standOffset, stand.z);
    this.heading = stand.heading;
    this.mode = 'ground';
    this.onWall = false;
    this.syncFlightWorld();
    this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
    if (opts.taste) this.fsm.beginTaste(this.heading);
    else this.fsm.reset(this.heading);
  }

  private placeAtPile(opts: { taste: boolean }): void {
    const xz = this.eatStandPoint();
    this.position.set(xz.x, this.surfaceYAt(xz.x, xz.z), xz.z);
    this.heading = this.eatStandHeading();
    this.mode = this.creatine() ? 'onFood' : 'ground';
    this.onWall = false;
    this.syncFlightWorld();
    this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
    if (opts.taste) this.fsm.beginTaste(this.heading);
    else this.fsm.reset(this.heading);
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
      eatBoutDone: this.eatScoopDone(),
      groomDone: false,
      gagDone: true,
      napDone: false,
      wakeDone: false,
      propDone: false,
      satiety: input.satiety,
      cropVolume: crop,
    };

    if (isWalkState(this.loop.state)) {
      flags.walkDone = this.stepWalkGoal(dt);
    } else if (this.loop.state === 'DROP_SCOOP') {
      this.propT += dt;
      this.stepWalkGoal(dt);
      flags.propDone = this.propT >= SCOOP_DROP_S;
    } else if (this.loop.state === 'PICK_SCOOP') {
      this.propT += dt;
      flags.propDone = this.propT >= SCOOP_PICK_S;
    } else if (this.loop.state === 'DIP_SCOOP') {
      this.propT += dt;
      flags.propDone = this.propT >= SCOOP_DIP_S;
    } else if (this.loop.state === 'WALK_MILL') {
      this.propT += dt;
      flags.propDone = this.propT >= MILL_WALK_S;
    } else if (this.loop.state === 'WALK_BIPED') {
      this.propT += dt;
      flags.propDone = this.propT >= BIPED_WALK_S;
    } else if (this.loop.state === 'WALK_BIPED_ON_MILL') {
      this.propT += dt;
      flags.propDone = this.propT >= MILL_WALK_S;
    } else if (this.loop.state === 'LAND_MILL') {
      if (this.flight.done) {
        this.lockMillStand(false);
        this.propT += dt;
        flags.propDone = this.propT >= MILL_LAND_HEX_S;
      }
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

    if (this.loop.state === 'AUTONOMOUS') this.stepAutonomousFlags(dt, input);

    let pose: Pose;
    let walk = 0;
    let pumpAmplitude = 0;
    const events: FeedingEvent[] = [];
    this.caption = loopOut.caption ?? '';
    this.spoonShadow = 0;
    this.crumbAttach = null;

    if (this.loop.state === 'LAND_MILL' && this.flight.done) {
      this.lockMillStand(false);
      this.mixer.play('idle');
      pose = this.mixer.update(dt);
      pose = this.applyGait(pose, false, dt);
      this.applyGroundWings(false);
      this.hudState = 'SEARCH';
    } else if (isFlightState(this.loop.state) || (this.loop.state === 'AUTONOMOUS' && (this.autoKind === 'flyIn' || this.autoKind === 'flyOut'))) {
      pose = this.applyFlightFrame(dt);
      this.hudState = 'SEARCH';
    } else if (this.loop.state === 'AUTONOMOUS') {
      const auto = this.updateAutonomous(input);
      pose = auto.pose;
      walk = auto.walk;
      pumpAmplitude = auto.pumpAmplitude;
      events.push(...auto.events);
    } else if (isWalkState(this.loop.state) || this.loop.state === 'DROP_SCOOP' || this.loop.state === 'PICK_SCOOP' || this.loop.state === 'DIP_SCOOP') {
      this.mixer.play(this.loop.state === 'DIP_SCOOP' ? 'idle' : 'approach');
      pose = this.mixer.update(dt);
      this.forelegExtend = this.creatine()?.scoopMode === 'held'
        ? (this.loop.state === 'DIP_SCOOP' || this.loop.state === 'PICK_SCOOP' ? 0.72 : 0.35)
        : 0;
      this.hudState = this.loop.state === 'DIP_SCOOP' ? 'TASTE' : 'APPROACH';
      if (this.loop.state === 'PICK_SCOOP') {
        pose = overlayEuler(pose, {
          foreleg_L_tarsus: [48, 8, 22],
          foreleg_R_tarsus: [52, -10, -28],
        });
        this.wingRaiseL = 0;
        this.wingRaiseR = 0;
        this.wingBlurL = 0;
        this.wingBlurR = 0;
      }
      pose = this.applyGait(pose, isWalkState(this.loop.state) || this.loop.state === 'DROP_SCOOP', dt);
      this.applyGroundWings(false);
    } else if (this.loop.state === 'WALK_MILL' || this.loop.state === 'WALK_BIPED' || this.loop.state === 'WALK_BIPED_ON_MILL') {
      this.mode = 'mill';
      this.mixer.play('approach');
      pose = this.mixer.update(dt);
      this.forelegExtend = 0.55;
      this.hudState = 'APPROACH';
      pose = this.applyGait(pose, true, dt);
      if (this.isBipedMill()) this.pitch = BIPED_BODY_PITCH_RAD;
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
    } else {
      const fed = this.updateFeeding(input, 'scoop');
      pose = fed.pose;
      walk = fed.walk;
      pumpAmplitude = fed.pumpAmplitude;
      events.push(...fed.events);
    }

    this.applyConstraints(dt);
    this.glueToFood();
    const pumping = (isEatState(this.loop.state) || this.autoKind === 'eat')
      && this.fsm.state === 'PUMP' && !this.refillClip;
    const foodOut = this.stepFood(input, pose, pumping);
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

  private stepWalkGoal(dt: number): boolean {
    if (!this.walkGoal) return true;
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
    return dist <= 3;
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
    if (support > tableTopY() + 0.5) return true;
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
    if (this.creatine() && (this.loop.state === 'EAT_SCOOP' || this.autoKind === 'eat')) return;
    const s = this.fsm.state;
    if (s !== 'TASTE' && s !== 'EXTEND' && s !== 'PUMP') {
      this.glueIndex = null;
      return;
    }
    if (!isEatState(this.loop.state) && this.autoKind !== 'eat') return;
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
    if (this.food instanceof CreatineSystem) {
      const { tub } = kitchenLayout();
      return {
        cx: tub.x,
        cy: tub.y,
        cz: tub.z,
        hx: tub.diameter / 2,
        hy: tub.height / 2,
        hz: tub.diameter / 2,
      };
    }
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

  private millObb3(): Obb3 {
    const m = kitchenLayout().mill;
    return {
      cx: m.x,
      cy: m.y,
      cz: m.z,
      hx: m.hx,
      hy: m.hy,
      hz: m.hz,
      yaw: m.yaw,
    };
  }

  /** Bench + four dumbbells. Mat is walkable support, not in this list. */
  private gymObbs(): Obb3[] {
    const { bench, dumbbells } = kitchenLayout();
    return [
      {
        cx: bench.x,
        cy: bench.y,
        cz: bench.z,
        hx: bench.hx,
        hy: bench.hy,
        hz: bench.hz,
        yaw: bench.yaw,
      },
      ...dumbbells.map((d) => ({
        cx: d.x,
        cy: d.y,
        cz: d.z,
        hx: d.hx,
        hy: d.hy,
        hz: d.hz,
        yaw: d.yaw,
      })),
    ];
  }

  private groundObbs(): Obb3[] {
    return [this.millObb3(), ...this.gymObbs()];
  }

  private pouchObb3(): Obb3 {
    return this.millObb3();
  }

  /** The chunk being pumped, as a shrinking morsel in the forelegs (PUMP only). */
  private heldCrumb(): DirectorOutput['heldCrumb'] {
    if (this.creatine()) return null;
    if (this.fsm.state !== 'PUMP' || this.refillClip) return null;
    const idx = this.food.consumingIndex();
    if (idx === null) return null;
    return { progress: this.food.consumeProgress(idx), chunkIndex: idx };
  }

  private scoopState(): DirectorOutput['scoop'] {
    const c = this.creatine();
    if (!c) return null;
    const dipU = this.loop.state === 'DIP_SCOOP'
      ? easeInOut(clamp01(this.loop.age / SCOOP_DIP_S))
      : 0;
    return { mode: c.scoopMode, fill: c.scoopFill, dipU };
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
      obbs: this.groundObbs(),
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
    const ghost = this.inTubGhost();
    this.flight.setWorld({
      obstacles: ghost ? [this.tableAabb3()] : [this.foodAabb3(), this.tableAabb3()],
      obbs: ghost ? [] : this.gymObbs(),
      floorY: ghost ? 0 : this.food.supportHeightAt(this.position.x, this.position.z, this.foodOrigin),
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
    if (this.mode === 'mill') {
      this.position.y = millSurfaceY(millStandXz().x) + this.standOffset + (this.isBipedMill() ? bipedStandLiftMm() : 0);
      this.stepping = false;
      return;
    }
    // Wall-feeding lift: pitch reads as about the hind feet, not the root.
    const target = this.surfaceY() + (this.mode === 'ground' ? wallFeedLiftMm() * this.wallFeedU : 0);
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
      if (!this.inTubGhost()) {
        const padded = this.food.clampRoot(
          { x: this.position.x, y: this.position.y, z: this.position.z },
          this.foodOrigin,
          foodStandPadMm(),
        );
        const packPos = clampOutsideXzObb(padded, this.pouch, bodyCollisionPadMm());
        let xz = { x: packPos.x, z: packPos.z };
        for (const obb of this.gymObbs()) {
          xz = clampOutsideXzObb(xz, obb, bodyCollisionPadMm());
        }
        this.position.x = xz.x;
        this.position.z = xz.z;
      }
    } else if (this.mode === 'mill') {
      const stand = millStandXz();
      this.position.x = stand.x;
      this.position.z = stand.z;
      this.heading = MILL_HEADING;
    }

    // In flight the FlightController already resolved solids (with face
    // hysteresis) inside `update()`; resolving again here with a different
    // face choice produced edge chatter. Ground / onFood still resolve here.
    if (this.mode !== 'flight' && this.mode !== 'mill' && !this.inTubGhost()) {
      const skipBoard = this.stepping && this.stepToY > this.stepFromY;
      const aabbs = this.mode === 'onFood' ? [this.tableAabb3()] : [this.foodAabb3(), this.tableAabb3()];
      const obbs = skipBoard ? [] : this.groundObbs();
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
      if (!this.inTubGhost()) {
        const floor = this.food.supportHeightAt(this.position.x, this.position.z, this.foodOrigin);
        this.position.y = clamp(this.position.y, floor, FLIGHT_CEILING_MM);
      } else {
        this.position.y = clamp(this.position.y, 0, FLIGHT_CEILING_MM);
      }
    } else {
      this.applyStandingY(dt);
    }

    if (this.flight.kind !== 'takeoff2' && !this.isBipedMill()) {
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
    if (this.isBipedMill()) this.pitch = BIPED_BODY_PITCH_RAD;

    if (this.mode === 'flight') {
      this.flight.position = { x: this.position.x, y: this.position.y, z: this.position.z };
      this.flight.velocity = { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z };
      this.flight.heading = this.heading;
      this.flight.pitch = this.pitch;
      this.flight.bank = this.bank;
      this.flight.roll = this.roll;
    }
  }

  private updateFeeding(input: DirectorInput, kind: 'top' | 'side' | 'scoop'): {
    pose: Pose;
    walk: number;
    pumpAmplitude: number;
    events: FeedingEvent[];
  } {
    const dt = input.dt;
    const foodXZ = { x: this.foodOrigin.x, z: this.foodOrigin.z };
    const posXZ = { x: this.position.x, z: this.position.z };
    const scoopEat = kind === 'scoop' && this.creatine() !== null;
    const approach = this.food.approachTarget(
      { x: this.position.x, y: this.position.y, z: this.position.z },
      this.foodOrigin,
    );
    const approachYaw = scoopEat ? this.eatStandHeading() : approach.yaw;
    const events: FeedingEvent[] = [];
    let walk = 0;
    let pumpAmplitude = 0;
    let pose: Pose;
    // Top landing: she is already on the food. Do not skip TASTE — only skip the walk.
    const distance = scoopEat ? 0.4 : kind === 'side' ? approach.distance : Math.min(approach.distance, 0.4);

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
        approachYaw,
        odorStrength: odorConcentration(posXZ, foodXZ, input.odor),
        distanceToFood: distance,
      });
      this.mixer.setAmplitude(output.pumpAmplitude);
      this.mixer.play(output.clip);
      pose = this.mixer.update(dt);
      this.heading = scoopEat ? this.eatStandHeading() : output.heading;
      walk = output.walk;
      pumpAmplitude = output.pumpAmplitude;
      this.hudState = output.state;
      events.push(...output.events);
      if (output.walk > 0 && kind === 'side') {
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
      } else if (kind === 'scoop') {
        this.mode = this.creatine() ? 'onFood' : 'ground';
        this.onWall = false;
      }
    }
    this.glueToFood();
    pose = this.applyWallFeedPosture(pose, dt);
    return { pose, walk, pumpAmplitude, events };
  }

  /** Feeding from the board at a vertical face: TASTE–RETRACT in ground mode. */
  private wallFeeding(): boolean {
    if (this.loop.state === 'EAT_SCOOP' || this.autoKind === 'eat') return false;
    if (this.mode !== 'ground' || this.onWall || this.refillClip) return false;
    const s = this.fsm.state;
    return s === 'TASTE' || s === 'EXTEND' || s === 'PUMP' || s === 'RETRACT';
  }

  /**
   * Ease the nose-up posture in/out and put the forelegs up on the food.
   * Top feeding (onFood) and walking keep pitch 0. The lift is applied in
   * applyStandingY so Y stays consistent with the board/food support.
   */
  private applyWallFeedPosture(pose: Pose, dt: number): Pose {
    const target = this.wallFeeding() ? 1 : 0;
    const k = 1 - Math.exp(-Math.max(0, dt) / WALL_FEED_TAU_S);
    this.wallFeedU += (target - this.wallFeedU) * k;
    if (this.wallFeedU < 1e-3) this.wallFeedU = 0;
    const u = this.wallFeedU;
    if (!this.onWall) this.pitch = wallFeedPitch() * u;
    this.forelegExtend = u;
    if (u <= 0) return pose;
    return overlayEuler(pose, {
      foreleg_L_tarsus: [55 * u, 0, 18 * u],
      foreleg_R_tarsus: [55 * u, 0, -18 * u],
    });
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
    }) ?? kinematicContacts(this.position, this.heading, this.foodOrigin, {
      pitch: this.pitch,
      extended: this.fsm.state === 'EXTEND' || this.fsm.state === 'PUMP',
      sensorY: topY,
    });
    this.contacts = contacts;
    return this.food.step({
      dt: input.dt,
      pumping,
      tasting: this.fsm.state === 'TASTE' || this.fsm.state === 'EXTEND' || this.fsm.state === 'PUMP',
      labellum: contacts.labellum,
      cameraDist: input.cameraDist,
      sensors: contacts.sensors,
      profile: this.creatine()?.profile ?? TWAROG_MAMUTA_WANILIOWY,
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
    if (this.isBipedMill() && dt > 1e-8) {
      this.gaitDistance = millGaitAdvance(this.gaitDistance, MILL_WALK_MM_S, dt);
      this.millSessionMm = millGaitAdvance(this.millSessionMm, MILL_WALK_MM_S, dt);
      next = replaceEuler(next, bipedPoseAtDistance(this.gaitDistance, MILL_WALK_MM_S));
    } else if ((this.mode === 'mill' || this.loop.state === 'WALK_MILL') && walking && dt > 1e-8) {
      this.gaitDistance = millGaitAdvance(this.gaitDistance, MILL_WALK_MM_S, dt);
      this.millSessionMm = millGaitAdvance(this.millSessionMm, MILL_WALK_MM_S, dt);
      next = replaceEuler(next, gaitPoseAtDistance(this.gaitDistance, MILL_WALK_MM_S, 0));
    } else if (walking && this.mode !== 'flight' && dt > 1e-8 && step > 0.02) {
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
      scoop: this.scoopState(),
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
      millDistanceMm: this.millSessionMm,
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
      foodStandPadMm(),
    );
    const packPos = clampOutsideXzObb(padded, this.pouch, bodyCollisionPadMm());
    this.position.x = packPos.x;
    this.position.z = packPos.z;
    this.mode = 'ground';
    pose = this.applyWallFeedPosture(pose, dt);
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
    }) ?? kinematicContacts(this.position, this.heading, this.foodOrigin, {
      pitch: this.pitch,
      extended: this.fsm.state === 'EXTEND' || this.fsm.state === 'PUMP',
    });
    this.contacts = contacts;
    const foodOut = this.food.step({
      dt,
      pumping: !this.refillClip && this.fsm.state === 'PUMP',
      tasting: this.fsm.state === 'TASTE' || this.fsm.state === 'EXTEND' || this.fsm.state === 'PUMP',
      labellum: contacts.labellum,
      cameraDist: input.cameraDist,
      sensors: contacts.sensors,
      profile: this.creatine()?.profile ?? TWAROG_MAMUTA_WANILIOWY,
      foodXZ,
      flyXZ: posXZ,
    });
    const { crumbs, portions } = this.collectFood(foodOut.events, events);
    return this.packOutput(pose, pumpAmplitude, walk, events, foodOut.chemo, portions, crumbs, input.cropVolume ?? 0);
  }
}
