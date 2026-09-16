/**
 * Orchestrates authored locomotion / comedy and the MN9 feeding gate.
 *
 * The connectome drives only gustatory channel → MN9 (the feeding FSM inside
 * EAT). Flight, walking, grooming, sleep and gags are authored and never
 * write into ActivityFrame or the brain worker. See docs/BODY-MODEL.md.
 */
import * as THREE from 'three';
import { CLIP_DURATION, MotionMixer, overlayEuler } from './feedingMotion.ts';
import { FeedingStateMachine } from './feedingStateMachine.ts';
import { odorConcentration, odorGradientYaw } from './odorField.ts';
import type { ClipName, FeedingEvent, FeedingState, Pose } from './types.ts';
import { TWAROG_MAMUTA_WANILIOWY } from '../food/foodProfile.ts';
import {
  TwarogSystem,
  clampOutsideXzObb,
  type ChemoSample,
  type ConsumeEvent,
  type Vec3,
} from '../food/twarogSystem.ts';
import {
  FLY_WALK_MM_S,
  bodyCollisionPadMm,
  labellumRestReachMm,
} from '../scene/scale.ts';
import { FlightController } from './flight.ts';
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
import { SceneLoop, isEatState, isFlightState, type LoopState } from './sceneLoop.ts';
import { kitchenLayout } from '../scene/layout.ts';

export type LocomotionMode = 'ground' | 'flight' | 'onFood';

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
  wingBlurAlpha: number;
  wingFlicker: number;
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

  private readonly foodOrigin: Vec3;
  private readonly pouch: PouchObb;
  private readonly spawn: THREE.Vector3;
  private readonly spawnHeading: number;
  private readonly sampleContacts?: SceneDirectorDeps['sampleContacts'];
  private refillClip: 'retract' | 'groom' | null = null;
  private refillHold = 0;
  private hudState: FeedingState = 'SEARCH';
  private seed: number;
  private lastLoop: LoopState = 'ORBIT';
  private loopWrapped = false;
  private eatSawRest = false;
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
  private wingBlur = 0;
  private wingFlicker = 0;
  private forelegExtend = 0;
  private caption = '';
  private spoonShadow = 0;
  private crumbAttach: CrumbBone = null;
  private onWall = false;
  private napDoubled = false;

  constructor(deps: SceneDirectorDeps) {
    this.food = deps.food;
    this.foodOrigin = { x: deps.foodOrigin.x, y: deps.foodOrigin.y, z: deps.foodOrigin.z };
    this.pouch = deps.pouch;
    this.spawn = new THREE.Vector3(deps.position.x, deps.position.y, deps.position.z);
    this.spawnHeading = deps.heading ?? 0.35;
    this.position = this.spawn.clone();
    this.velocity = new THREE.Vector3();
    this.heading = this.spawnHeading;
    this.fsm = new FeedingStateMachine({ heading: this.spawnHeading });
    this.sampleContacts = deps.sampleContacts;
    this.scriptedLoop = !!deps.scriptedLoop;
    this.seed = deps.seed ?? 1;
    this.loop = new SceneLoop(this.seed);
    this.mixer.play('odorTrack', { fade: 0 });
    this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
    if (this.scriptedLoop) this.beginLoopState('ORBIT');
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
    this.wingBlur = 0;
    this.caption = '';
    this.spoonShadow = 0;
    this.crumbAttach = null;
    this.onWall = false;
    this.eatSawRest = false;
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
    this.groomT = 0;
    this.napT = 0;
    this.wakeT = 0;
    this.onWall = false;
    this.caption = '';
    this.spoonShadow = 0;
    this.crumbAttach = null;
    this.napDoubled = false;
    const food = this.foodOrigin;
    const stand = this.spawn.y;
    if (state === 'ORBIT' || state === 'ORBIT_SHORT') {
      this.mode = 'flight';
      this.flight.place({ x: this.position.x, y: Math.max(this.position.y, 18), z: this.position.z }, this.heading);
      this.flight.startOrbit({
        target: food,
        circuits: state === 'ORBIT_SHORT' ? 1 : this.loop.orbitCircuits,
        descend: state === 'ORBIT',
        seed: this.seed + (state === 'ORBIT_SHORT' ? 3 : 0),
      });
    } else if (state === 'LAND_TOP') {
      this.mode = 'flight';
      const support = this.food.supportHeightAt(food.x, food.z, food) + stand;
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startLand({ target: { x: food.x, y: support, z: food.z }, supportY: support, seed: this.seed + 5 });
    } else if (state === 'LAND_TABLE') {
      this.mode = 'flight';
      const layout = kitchenLayout();
      const target = { x: layout.fly.x, y: stand, z: layout.fly.z };
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startLand({ target, supportY: stand, seed: this.seed + 7 });
    } else if (state === 'TAKEOFF_1' || state === 'TAKEOFF_EXIT') {
      this.mode = 'flight';
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startTakeoff1();
    } else if (state === 'EXIT_FRAME') {
      this.mode = 'flight';
      this.flight.place({ x: this.position.x, y: this.position.y, z: this.position.z }, this.heading);
      this.flight.startExit(this.heading);
    } else if (isEatState(state)) {
      this.fsm.reset(this.heading);
      this.mixer.play('odorTrack', { fade: 0, restart: true });
      this.mode = state === 'EAT_TOP' ? 'onFood' : 'ground';
    } else if (state === 'WALK_TOP') {
      this.mode = 'onFood';
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
      pouch: { x: this.pouch.cx, y: 1.2, z: this.pouch.cz, yaw: this.pouch.yaw },
      food: this.foodOrigin,
      standingY: this.spawn.y,
    };
  }

  private updateLoop(input: DirectorInput): DirectorOutput {
    const dt = input.dt;
    const crop = input.cropVolume ?? 0;
    this.loopWrapped = false;
    const flags = {
      flightDone: this.flight.kind !== 'idle' && this.flight.done,
      walkDone: false,
      eatBoutDone: this.eatSawRest && this.fsm.state === 'SEARCH',
      groomDone: false,
      gagDone: this.loop.state === 'GAG' && this.loop.gag !== null ? !this.gags.active : this.loop.gag === null,
      napDone: false,
      wakeDone: false,
      satiety: input.satiety,
      cropVolume: crop,
    };

    if (this.loop.state === 'WALK_TOP') flags.walkDone = this.stepWalkTop(dt);
    else if (this.loop.state === 'GROOM_SHORT') {
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
      if (loopOut.state === 'ORBIT' && this.lastLoop === 'EXIT_FRAME') {
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
      const frame = this.flight.update(dt);
      this.position.set(frame.position.x, frame.position.y, frame.position.z);
      this.velocity.set(frame.velocity.x, frame.velocity.y, frame.velocity.z);
      this.heading = frame.heading;
      this.pitch = frame.pitch;
      this.bank = frame.bank;
      this.roll = frame.roll;
      this.wingRaiseL = frame.wingRaise;
      this.wingRaiseR = frame.wingRaise;
      this.wingBlur = frame.blurAlpha;
      this.wingFlicker = frame.flicker;
      this.forelegExtend = frame.forelegExtend;
      this.mode = 'flight';
      this.mixer.play('idle');
      pose = overlayEuler(this.mixer.update(dt), {
        foreleg_L_tarsus: [55 * frame.forelegExtend, 0, 18 * frame.forelegExtend],
        foreleg_R_tarsus: [55 * frame.forelegExtend, 0, -18 * frame.forelegExtend],
      });
      this.hudState = 'SEARCH';
    } else if (this.loop.state === 'WALK_TOP') {
      this.mixer.play('approach');
      pose = this.mixer.update(dt);
      this.wingRaiseL = 0;
      this.wingRaiseR = 0;
      this.wingBlur = 0;
      this.forelegExtend = 0;
      this.hudState = 'APPROACH';
    } else if (this.loop.state === 'GROOM_SHORT' || this.loop.state === 'GROOM_FULL') {
      this.mixer.play('groom');
      pose = this.mixer.update(dt);
      const overlay = this.loop.state === 'GROOM_SHORT'
        ? groomShortOverlay(this.groomT)
        : groomFullOverlay(this.groomT);
      pose = applyGroomNap(pose, overlay);
      this.wingRaiseL = overlay.wingRaise;
      this.wingRaiseR = overlay.wingRaise;
      this.hudState = 'REST';
    } else if (this.loop.state === 'NAP') {
      this.mixer.play('idle');
      pose = applyGroomNap(this.mixer.update(dt), napOverlay(this.napT, input.satiety, this.napDoubled));
      this.position.y = this.surfaceY() - napOverlay(this.napT, input.satiety, this.napDoubled).sinkMm;
      this.caption = 'Trawi';
      this.hudState = 'REST';
    } else if (this.loop.state === 'WAKE') {
      this.mixer.play('idle');
      pose = applyGroomNap(this.mixer.update(dt), wakeOverlay(this.wakeT));
      this.hudState = 'SEARCH';
    } else if (this.loop.state === 'GAG') {
      pose = this.updateGag(dt, input, crop);
    } else {
      const fed = this.updateFeeding(input, this.loop.state === 'EAT_TOP' ? 'top' : 'side');
      pose = fed.pose;
      walk = fed.walk;
      pumpAmplitude = fed.pumpAmplitude;
      events.push(...fed.events);
    }

    this.applyConstraints();
    const foodOut = this.stepFood(input, pose, isEatState(this.loop.state) && this.fsm.state === 'PUMP' && !this.refillClip);
    if (this.mode === 'onFood' && !this.onWall) this.position.y = this.surfaceY();
    const { crumbs, portions } = this.collectFood(foodOut.events, events);
    if (this.fsm.state === 'REST') this.eatSawRest = true;
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
      this.flight.startTakeoff2({ x: this.foodOrigin.x, y: support, z: this.foodOrigin.z });
    }
    if (gag.escape) {
      const frame = this.flight.update(dt);
      this.position.set(frame.position.x, frame.position.y, frame.position.z);
      this.heading = frame.heading;
      this.roll = frame.roll;
      this.wingRaiseL = frame.wingRaise;
      this.wingRaiseR = frame.wingRaise;
      this.wingBlur = frame.blurAlpha;
      this.mode = 'flight';
      this.mixer.play('idle');
      if (frame.done) this.gags.start(null, this.gagCtx(input.satiety, crop));
      return this.mixer.update(dt);
    }
    this.position.set(gag.position.x, gag.position.y, gag.position.z);
    this.heading = gag.heading;
    this.mode = gag.mode;
    this.wingRaiseL = gag.wingRaiseL;
    this.wingRaiseR = gag.wingRaiseR;
    this.wingSongL = gag.wingSongL;
    this.wingSongR = gag.wingSongR;
    this.mixer.play('idle');
    if (gag.nap) this.napDoubled = gag.napDoubled;
    if (gag.done) this.gags.start(null, this.gagCtx(input.satiety, crop));
    this.hudState = 'REST';
    return overlayEuler(this.mixer.update(dt), gag.euler);
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

  private surfaceY(): number {
    if (this.mode === 'onFood' && !this.onWall) {
      return this.food.supportHeightAt(this.position.x, this.position.z, this.foodOrigin) + this.spawn.y;
    }
    return this.spawn.y;
  }

  private applyConstraints(): void {
    if (this.mode === 'flight') return;
    if (this.mode === 'onFood') {
      if (this.onWall) {
        const p = this.food.projectOntoVerticalFace(
          { x: this.position.x, y: this.position.y, z: this.position.z },
          this.foodOrigin,
          bodyCollisionPadMm() * 0.15,
        );
        this.position.x = p.x;
        this.position.z = p.z;
        this.pitch = Math.PI / 2;
      } else {
        this.position.y = this.surfaceY();
        this.pitch = 0;
      }
      return;
    }
    const padded = this.food.clampRoot(
      { x: this.position.x, y: this.position.y, z: this.position.z },
      this.foodOrigin,
    );
    const packPos = clampOutsideXzObb(padded, this.pouch, bodyCollisionPadMm());
    this.position.x = packPos.x;
    this.position.z = packPos.z;
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
      if (kind === 'side' && approach.distance < 10 && this.fsm.state === 'APPROACH') {
        this.onWall = true;
        this.mode = 'onFood';
        this.position.y = Math.min(this.foodOrigin.y, this.position.y + 12 * dt);
      } else if (kind === 'top') {
        this.mode = 'onFood';
        this.onWall = false;
      }
    }
    this.wingRaiseL = 0;
    this.wingRaiseR = 0;
    this.wingBlur = 0;
    this.forelegExtend = 0;
    this.pitch = this.onWall ? Math.PI / 2 : 0;
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
        wingBlurAlpha: this.wingBlur,
        wingFlicker: this.wingFlicker,
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
      bites: this.fsm.pumpCycles,
      bitesTarget: this.fsm.pumpTarget,
      remainingFrac: this.food.totalMassGrams > 0
        ? this.food.remainingMassGrams / this.food.totalMassGrams
        : 0,
      portionCount: this.food.portionCount,
      gramsEaten: this.food.totalMassGrams - this.food.remainingMassGrams,
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
