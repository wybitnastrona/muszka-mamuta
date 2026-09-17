import { describe, expect, it } from 'vitest';
import { SceneDirector } from '../../src/body/sceneDirector.ts';
import { isEatState, LOOP_STATES, type LoopVariant } from '../../src/body/sceneLoop.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';
import { POUCH_MM, boardTopY, flyVisualLengthMm, mm, standoffMm } from '../../src/scene/scale.ts';
import { fractureCurdBlock } from '../../src/food/proceduralTwarog.ts';
import { closestXzAabb, TwarogSystem, pointInXzAabb } from '../../src/food/twarogSystem.ts';
import { UP_ALIGN_MAX_RAD, bodyUpAxis, pointInAabb3, tiltFromNormal } from '../../src/body/collision.ts';

function makeLoopDirector(variant: LoopVariant = 'reel') {
  const layout = kitchenLayout();
  const food = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
  return new SceneDirector({
    food,
    foodOrigin: { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z },
    pouch: {
      cx: layout.pouch.x,
      cz: layout.pouch.z,
      hx: mm(POUCH_MM.length) / 2,
      hz: mm(POUCH_MM.width) / 2,
      yaw: layout.pouch.yaw,
    },
    position: { x: layout.fly.x, y: layout.board.topY + 2, z: layout.fly.z },
    heading: 0.35,
    seed: 1,
    scriptedLoop: true,
    loopVariant: variant,
  });
}

const drive = {
  dt: 1 / 30,
  mn9Rate: 20,
  satiety: 0.9,
  bitter: 0,
  odor: 1,
  cameraDist: 400,
  cropVolume: 0.3,
};

function inFoodContact(d: SceneDirector): boolean {
  const layout = kitchenLayout();
  const origin = { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z };
  if (d.mode === 'onFood') return true;
  const support = d.food.supportHeightAt(d.position.x, d.position.z, origin);
  if (support > boardTopY() + 0.5) return true;
  const xz = d.food.worldAabb(origin);
  if (pointInXzAabb({ x: d.position.x, z: d.position.z }, xz)) return true;
  const hit = closestXzAabb({ x: d.position.x, z: d.position.z }, xz);
  const dist = Math.hypot(d.position.x - hit.x, d.position.z - hit.z);
  return dist <= standoffMm() + flyVisualLengthMm();
}

describe('SceneDirector scripted loop (reel)', () => {
  it('spawns on the block top face in TASTE range of a chunk', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    const origin = { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z };
    const box = {
      cx: origin.x, cy: origin.y, cz: origin.z,
      hx: d.food.hx, hy: d.food.hy, hz: d.food.hz,
    };
    const xz = d.food.worldAabb(origin);
    const out = d.update(drive);
    expect(out.macro).toBe('EAT_TOP');
    expect(out.mode).toBe('onFood');
    expect(d.fsm.state).toBe('TASTE');
    expect(pointInXzAabb({ x: d.position.x, z: d.position.z }, xz)).toBe(true);
    expect(pointInAabb3(d.position, box, -0.05)).toBe(false);
    const support = d.food.supportHeightAt(d.position.x, d.position.z, origin);
    expect(d.position.y).toBeCloseTo(support + 2, 0);
  });

  it('glues TASTE / EXTEND / PUMP to the nearest uneaten chunk', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    const origin = { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z };
    d.update(drive);
    expect(d.fsm.state).toBe('TASTE');
    d.position.x = origin.x + 180;
    d.position.z = origin.z + 180;
    d.update({ ...drive, dt: 0 });
    const lx = d.position.x - origin.x;
    const lz = d.position.z - origin.z;
    let best = Infinity;
    for (const c of d.food.chunks) {
      if (c.eaten) continue;
      best = Math.min(best, Math.hypot(c.centroid.x - lx, c.centroid.z - lz));
    }
    expect(best).toBeLessThanOrEqual(flyVisualLengthMm() + 0.05);
  });

  it('holds a shrinking morsel in the forelegs only while PUMP consumes a chunk', () => {
    const d = makeLoopDirector();
    const progress: number[] = [];
    let sawTaste = false;
    let sawPump = false;
    for (let i = 0; i < 30 * 12; i++) {
      const out = d.update({ ...drive, satiety: 0.2 });
      if (d.fsm.state === 'TASTE' || d.fsm.state === 'EXTEND' || d.fsm.state === 'REST') {
        sawTaste = true;
        expect(out.heldCrumb).toBeNull();
      }
      if (d.fsm.state === 'PUMP' && out.heldCrumb) {
        sawPump = true;
        progress.push(out.heldCrumb.progress);
        expect(d.food.chunks[out.heldCrumb.chunkIndex]!.eaten).toBe(false);
      }
      if (d.fsm.state === 'RETRACT') break;
    }
    expect(sawTaste).toBe(true);
    expect(sawPump).toBe(true);
    expect(progress.length).toBeGreaterThan(2);
    expect(progress[0]!).toBeLessThan(0.5);
    expect(Math.max(...progress)).toBeGreaterThan(progress[0]!);
    for (const p of progress) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('completes one reel loop at seed 1 without ORBIT / EXIT_FRAME', () => {
    const d = makeLoopDirector();
    const seen: string[] = [];
    let extendBeforeLand = 0;
    let landings = 0;
    let prevMacro = '';
    let wrapped = false;
    for (let i = 0; i < 5000; i++) {
      const out = d.update(drive);
      if (out.loopWrapped) wrapped = true;
      if (!seen.includes(out.macro)) seen.push(out.macro);
      if (out.macro === 'LAND_TOP' || out.macro === 'LAND_TABLE') {
        if (out.flyPose.forelegExtend > 0.4 && out.flyPose.position.y > 3) extendBeforeLand = 1;
        if (out.macro !== prevMacro) landings += 1;
      }
      prevMacro = out.macro;
      if (wrapped && out.macro === 'EAT_TOP' && i > 200) break;
    }
    for (const state of ['EAT_TOP', 'GROOM_SHORT', 'WALK_REPOSITION', 'TAKEOFF_1', 'LAND_TABLE', 'EAT_SIDE'] as const) {
      expect(seen, state).toContain(state);
    }
    expect(seen).not.toContain('ORBIT');
    expect(seen).not.toContain('EXIT_FRAME');
    expect(landings).toBeGreaterThanOrEqual(1);
    expect(extendBeforeLand).toBe(1);
    expect(wrapped).toBe(true);
    expect(LOOP_STATES.length).toBeGreaterThan(8);
  });

  it('stays on the food ≥ 70 s of a 90 s seeded loop, with only allowed takeoffs', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    const origin = { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z };
    const xz = d.food.worldAabb(origin);
    const dt = 1 / 30;
    const hunger = { ...drive, satiety: 0.3, cropVolume: 0.3 };
    const steps = Math.round(90 / dt);
    let onFoodS = 0;
    const takeoffKinds = new Set<string>();
    let forbiddenFlight = false;
    let gagAtTakeoff2: string | null = null;
    const bl = flyVisualLengthMm();
    for (let i = 0; i < steps; i++) {
      const out = d.update(hunger);
      if (inFoodContact(d)) onFoodS += dt;
      if (d.flight.kind === 'takeoff1') takeoffKinds.add('takeoff1');
      if (d.flight.kind === 'takeoff2') {
        takeoffKinds.add('takeoff2');
        gagAtTakeoff2 = out.gag;
      }
      if (
        out.macro === 'ORBIT'
        || out.macro === 'ORBIT_SHORT'
        || out.macro === 'TAKEOFF_EXIT'
        || out.macro === 'EXIT_FRAME'
      ) {
        forbiddenFlight = true;
      }
      if (isEatState(out.macro)) {
        const pad = out.macro === 'EAT_TOP' ? bl : standoffMm() + bl;
        expect(pointInXzAabb({ x: d.position.x, z: d.position.z }, xz, pad)).toBe(true);
      }
    }
    expect(onFoodS).toBeGreaterThanOrEqual(70);
    expect(forbiddenFlight).toBe(false);
    for (const kind of takeoffKinds) {
      expect(kind === 'takeoff1' || kind === 'takeoff2').toBe(true);
    }
    if (takeoffKinds.has('takeoff2')) expect(gagAtTakeoff2).toBe('escapeShadow');
  });

  it('visits flight, onFood and ground without flying through the block', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    const origin = { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z };
    const box = { cx: origin.x, cy: origin.y, cz: origin.z, hx: d.food.hx, hy: d.food.hy, hz: d.food.hz };
    const xz = d.food.worldAabb(origin);
    const seen = new Set<string>();
    let groundPushedOut = false;
    let onFoodFollowed = false;
    for (let i = 0; i < 5000; i++) {
      const out = d.update(drive);
      seen.add(out.mode);
      if (out.mode === 'flight') {
        expect(pointInAabb3(d.position, box, -0.05)).toBe(false);
      }
      if (out.mode === 'ground') {
        expect(pointInXzAabb(d.position, xz)).toBe(false);
        groundPushedOut = true;
      }
      if (out.mode === 'onFood' && out.macro === 'EAT_TOP') {
        const support = d.food.supportHeightAt(d.position.x, d.position.z, origin);
        expect(d.position.y).toBeCloseTo(support + 2, 0);
        onFoodFollowed = true;
      }
      if (seen.has('flight') && seen.has('onFood') && seen.has('ground') && onFoodFollowed && groundPushedOut) break;
    }
    expect(seen.has('flight')).toBe(true);
    expect(seen.has('onFood')).toBe(true);
    expect(seen.has('ground')).toBe(true);
    expect(groundPushedOut).toBe(true);
    expect(onFoodFollowed).toBe(true);
  });

  it('keeps the up vector within 35° of +Y except during takeoff2', () => {
    const d = makeLoopDirector();
    const upN = { x: 0, y: 1, z: 0 };
    for (let i = 0; i < 4000; i++) {
      const out = d.update(drive);
      if (d.flight.kind === 'takeoff2') continue;
      const up = bodyUpAxis(out.flyPose.pitch, out.flyPose.heading, out.flyPose.bank + out.flyPose.roll);
      expect(tiltFromNormal(up, upN)).toBeLessThanOrEqual(UP_ALIGN_MAX_RAD + 0.08);
      if (out.loopWrapped) break;
    }
  });

  it('onFood Y follows supportHeightAt after a chunk is eaten', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    let onFood = false;
    for (let i = 0; i < 2500; i++) {
      const out = d.update(drive);
      if (out.mode === 'onFood' && !onFood) {
        onFood = true;
        const origin = { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z };
        const before = d.food.supportHeightAt(d.position.x, d.position.z, origin);
        const under = d.food.chunks.find((c) => !c.eaten
          && Math.hypot(c.centroid.x - (d.position.x - origin.x), c.centroid.z - (d.position.z - origin.z)) <= c.radiusXz);
        if (under) d.food.commitChunk(under.index);
        const after = d.food.supportHeightAt(d.position.x, d.position.z, origin);
        d.mode = 'onFood';
        d.update({ ...drive, dt: 0 });
        expect(after).toBeLessThanOrEqual(before);
        expect(d.position.y).toBeCloseTo(after + 2, 0);
        return;
      }
    }
    expect(onFood).toBe(true);
  });
});

describe('SceneDirector scripted loop (full)', () => {
  it('starts in flight (ORBIT) and is pushed out of the block', () => {
    const d = makeLoopDirector('full');
    const layout = kitchenLayout();
    const box = {
      cx: layout.curd.x, cy: layout.curd.y, cz: layout.curd.z,
      hx: d.food.hx, hy: d.food.hy, hz: d.food.hz,
    };
    const out = d.update(drive);
    expect(out.macro).toBe('ORBIT');
    expect(out.mode).toBe('flight');
    d.position.set(layout.curd.x, layout.curd.y, layout.curd.z);
    d.update(drive);
    expect(pointInAabb3(d.position, box, -0.05)).toBe(false);
    expect(d.mode).toBe('flight');
  });
});
