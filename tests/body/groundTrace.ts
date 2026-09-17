/**
 * Frozen copy of the FlyScene ground integrator as it existed before
 * SceneDirector. Used only to record / compare the refactor fixture.
 */
import { CLIP_DURATION, MotionMixer } from '../../src/body/feedingMotion.ts';
import { FeedingStateMachine } from '../../src/body/feedingStateMachine.ts';
import { odorConcentration, odorGradientYaw } from '../../src/body/odorField.ts';
import type { ClipName, FeedingState } from '../../src/body/types.ts';
import { TWAROG_MAMUTA_WANILIOWY } from '../../src/food/foodProfile.ts';
import { fractureCurdBlock } from '../../src/food/proceduralTwarog.ts';
import { TwarogSystem, clampOutsideXzObb } from '../../src/food/twarogSystem.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';
import {
  FLY_WALK_MM_S,
  POUCH_MM,
  bodyCollisionPadMm,
  labellumRestReachMm,
  mm,
} from '../../src/scene/scale.ts';

export type GroundTraceFrame = {
  i: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  state: FeedingState;
  clip: ClipName;
  clipTime: number;
  walk: number;
  pumpAmplitude: number;
  hudState: FeedingState;
};

export type GroundTraceOpts = {
  steps: number;
  dt?: number;
  mn9Rate?: number;
  satiety?: number;
  bitter?: number;
  odor?: number;
};

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function pouchObb() {
  const layout = kitchenLayout();
  return {
    cx: layout.pouch.x,
    cz: layout.pouch.z,
    hx: mm(POUCH_MM.length) / 2,
    hz: mm(POUCH_MM.width) / 2,
    yaw: layout.pouch.yaw,
  };
}

export function runGroundTrace(opts: GroundTraceOpts): GroundTraceFrame[] {
  const dt = opts.dt ?? 1 / 60;
  const live = {
    mn9Rate: opts.mn9Rate ?? 0,
    satiety: opts.satiety ?? 0.2,
    bitter: opts.bitter ?? 0,
    odor: opts.odor ?? TWAROG_MAMUTA_WANILIOWY.odor,
  };
  const layout = kitchenLayout();
  const food = { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z };
  const foodXZ = { x: food.x, z: food.z };
  const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
  const fsm = new FeedingStateMachine({ heading: 0.35 });
  const mixer = new MotionMixer();
  mixer.play('odorTrack', { fade: 0 });
  const pouch = pouchObb();
  let pos = { x: layout.fly.x, y: layout.board.topY + 2, z: layout.fly.z };
  let refillClip: 'retract' | 'groom' | null = null;
  let refillHold = 0;
  let hudState: FeedingState = 'SEARCH';
  const frames: GroundTraceFrame[] = [];
  const reach = labellumRestReachMm();

  for (let i = 0; i < opts.steps; i++) {
    const posXZ = { x: pos.x, z: pos.z };
    const approach = sys.approachTarget(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: food.x, y: food.y, z: food.z },
    );
    const dist = approach.distance;
    let walk = 0;
    let heading = fsm.heading;
    let pumpAmplitude = 0;

    if (refillClip) {
      refillHold += dt;
      mixer.update(dt);
      if (refillHold >= CLIP_DURATION[refillClip]) {
        if (refillClip === 'retract') {
          refillClip = 'groom';
          refillHold = 0;
          mixer.play('groom', { restart: true, fade: 0.08 });
          hudState = 'REST';
        } else {
          refillClip = null;
          refillHold = 0;
          fsm.reset(fsm.heading);
          hudState = fsm.state;
        }
      }
      heading = fsm.heading;
    } else {
      const output = fsm.step({
        dt,
        mn9Rate: live.mn9Rate,
        bitter: live.bitter,
        satiety: live.satiety,
        odorYaw: odorGradientYaw(posXZ, foodXZ),
        approachYaw: approach.yaw,
        odorStrength: odorConcentration(posXZ, foodXZ, live.odor),
        distanceToFood: dist,
      });
      mixer.setAmplitude(output.pumpAmplitude);
      mixer.play(output.clip);
      mixer.update(dt);
      heading = output.heading;
      walk = output.walk;
      pumpAmplitude = output.pumpAmplitude;
      hudState = output.state;
      if (output.walk > 0) {
        pos.x += Math.sin(output.heading) * FLY_WALK_MM_S * dt;
        pos.z += Math.cos(output.heading) * FLY_WALK_MM_S * dt;
      }
    }

    const padded = sys.clampRoot(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: food.x, y: food.y, z: food.z },
    );
    const packPos = clampOutsideXzObb(padded, pouch, bodyCollisionPadMm());
    pos.x = packPos.x;
    pos.z = packPos.z;

    const flyLocal = { x: pos.x - food.x, y: pos.y - food.y, z: pos.z - food.z };
    sys.followBiteFront(flyLocal);
    const labW = {
      x: pos.x + Math.sin(heading) * reach,
      y: pos.y,
      z: pos.z + Math.cos(heading) * reach,
    };
    const labLocal = { x: labW.x - food.x, y: labW.y - food.y, z: labW.z - food.z };
    const foodOut = sys.step({
      dt,
      pumping: !refillClip && fsm.state === 'PUMP',
      labellum: labLocal,
      cameraDist: 400,
      sensors: [labLocal, labLocal, labLocal, labLocal],
      profile: TWAROG_MAMUTA_WANILIOWY,
      foodXZ,
      flyXZ: posXZ,
    });
    for (const ev of foodOut.events) {
      if (ev.type === 'groom') {
        refillClip = 'retract';
        refillHold = 0;
        mixer.play('retract', { restart: true, fade: 0.1 });
        hudState = 'RETRACT';
      }
    }

    frames.push({
      i,
      x: round(pos.x),
      y: round(pos.y),
      z: round(pos.z),
      heading: round(heading),
      state: fsm.state,
      clip: mixer.clip.name,
      clipTime: round(mixer.time),
      walk: round(walk),
      pumpAmplitude: round(pumpAmplitude),
      hudState,
    });
  }
  return frames;
}
