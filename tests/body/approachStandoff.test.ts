import { describe, expect, it } from 'vitest';
import {
  APPROACH_ARRIVE_MM,
  FeedingStateMachine,
} from '../../src/body/feedingStateMachine.ts';
import { odorGradientYaw } from '../../src/body/odorField.ts';
import { fractureCurdBlock } from '../../src/food/proceduralTwarog.ts';
import {
  TwarogSystem,
  clampOutsideXzObb,
  pointInXzAabb,
} from '../../src/food/twarogSystem.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';
import {
  FLY_WALK_MM_S,
  POUCH_MM,
  bodyCollisionPadMm,
  contactRadiusMm,
  extendedLabellumReachMm,
  mm,
  standoffMm,
} from '../../src/scene/scale.ts';

const dt = 1 / 60;

describe('APPROACH surface standoff', () => {
  it('ends outside the food AABB with the labellum on a surface chunk from 12 starts', () => {
    const layout = kitchenLayout();
    const food = { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z };
    const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
    const box = sys.worldAabb(food);
    const pouch = {
      cx: layout.pouch.x,
      cz: layout.pouch.z,
      hx: mm(POUCH_MM.length) / 2,
      hz: mm(POUCH_MM.width) / 2,
      yaw: layout.pouch.yaw,
    };
    const radius = Math.max(box.hx, box.hz) + standoffMm() + 40;
    const starts = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return { x: food.x + Math.sin(a) * radius, z: food.z + Math.cos(a) * radius };
    });

    for (const start of starts) {
      sys.reset();
      let pos = { x: start.x, y: 2, z: start.z };
      const sm = new FeedingStateMachine({ heading: odorGradientYaw(pos, food) });
      let heading = sm.heading;
      for (let i = 0; i < 2400; i++) {
        const approach = sys.approachTarget(pos, food);
        const out = sm.step({
          dt,
          mn9Rate: 0,
          bitter: 0,
          satiety: 0.2,
          odorYaw: odorGradientYaw(pos, food),
          approachYaw: approach.yaw,
          odorStrength: 1,
          distanceToFood: approach.distance,
        });
        heading = out.heading;
        if (out.walk > 0) {
          pos = {
            x: pos.x + Math.sin(heading) * FLY_WALK_MM_S * dt,
            y: pos.y,
            z: pos.z + Math.cos(heading) * FLY_WALK_MM_S * dt,
          };
        }
        pos = sys.clampRoot(pos, food);
        const packed = clampOutsideXzObb(pos, pouch, bodyCollisionPadMm());
        pos = { x: packed.x, y: pos.y, z: packed.z };
        if (sm.state !== 'SEARCH' && sm.state !== 'ORIENT' && sm.state !== 'APPROACH') break;
      }
      expect(sm.state).toBe('TASTE');
      expect(pointInXzAabb(pos, box)).toBe(false);
      const reach = extendedLabellumReachMm();
      const labellum = {
        x: pos.x + Math.sin(heading) * reach - food.x,
        y: -sys.hy * 0.45,
        z: pos.z + Math.cos(heading) * reach - food.z,
      };
      const chunk = sys.nearestUneaten(labellum, contactRadiusMm());
      expect(chunk).not.toBeNull();
    }
  });

  it('does not leave APPROACH until the standoff point is reached', () => {
    const sm = new FeedingStateMachine({ heading: 0 });
    for (let i = 0; i < 180; i++) {
      sm.step({
        dt,
        mn9Rate: 0,
        bitter: 0,
        satiety: 0.2,
        odorYaw: 0,
        approachYaw: 0,
        odorStrength: 1,
        distanceToFood: APPROACH_ARRIVE_MM + 20,
      });
    }
    expect(sm.state).toBe('APPROACH');
  });
});
