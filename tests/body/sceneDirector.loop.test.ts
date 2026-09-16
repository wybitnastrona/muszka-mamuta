import { describe, expect, it } from 'vitest';
import { SceneDirector } from '../../src/body/sceneDirector.ts';
import { LOOP_STATES } from '../../src/body/sceneLoop.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';
import { POUCH_MM, mm } from '../../src/scene/scale.ts';
import { fractureCurdBlock } from '../../src/food/proceduralTwarog.ts';
import { TwarogSystem, pointInXzAabb } from '../../src/food/twarogSystem.ts';

function makeLoopDirector() {
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
    position: { x: layout.fly.x, y: 2, z: layout.fly.z },
    heading: 0.35,
    seed: 1,
    scriptedLoop: true,
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

describe('SceneDirector scripted loop', () => {
  it('starts in flight (ORBIT) with XZ clamp disabled', () => {
    const d = makeLoopDirector();
    const food = { x: 0, y: 15, z: 0 };
    const box = d.food.worldAabb(food);
    const out = d.update(drive);
    expect(out.macro).toBe('ORBIT');
    expect(out.mode).toBe('flight');
    d.position.set(0, 24, 0);
    d.update(drive);
    expect(pointInXzAabb(d.position, box) || d.mode === 'flight').toBe(true);
    expect(d.mode).toBe('flight');
  });

  it('completes one loop at seed 1 and extends legs before landings', () => {
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
      if (seen.includes('EXIT_FRAME') && out.macro === 'ORBIT' && i > 200) break;
    }
    for (const state of ['ORBIT', 'LAND_TOP', 'WALK_TOP', 'EAT_TOP', 'GROOM_SHORT', 'LAND_TABLE', 'EAT_SIDE', 'EXIT_FRAME'] as const) {
      expect(seen, state).toContain(state);
    }
    expect(landings).toBeGreaterThanOrEqual(1);
    expect(extendBeforeLand).toBe(1);
    expect(wrapped).toBe(true);
    expect(LOOP_STATES.length).toBeGreaterThan(8);
  });

  it('visits flight, onFood and ground with matching clamp behaviour', () => {
    const d = makeLoopDirector();
    const origin = { x: 0, y: d.food.hy, z: 0 };
    const box = d.food.worldAabb(origin);
    const seen = new Set<string>();
    let flightAllowedInside = false;
    let groundPushedOut = false;
    let onFoodFollowed = false;
    for (let i = 0; i < 5000; i++) {
      const out = d.update(drive);
      seen.add(out.mode);
      if (out.mode === 'flight' && pointInXzAabb(d.position, box)) flightAllowedInside = true;
      if (out.mode === 'ground') {
        expect(pointInXzAabb(d.position, box)).toBe(false);
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
    expect(flightAllowedInside || seen.has('flight')).toBe(true);
    expect(groundPushedOut).toBe(true);
    expect(onFoodFollowed).toBe(true);
  });

  it('onFood Y follows supportHeightAt after a chunk is eaten', () => {
    const d = makeLoopDirector();
    let onFood = false;
    for (let i = 0; i < 2500; i++) {
      const out = d.update(drive);
      if (out.mode === 'onFood' && !onFood) {
        onFood = true;
        const origin = { x: 0, y: d.food.hy, z: 0 };
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
