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
  FLY_RENDER_SCALE,
  FLY_WALK_MM_S,
  POUCH_MM,
  WALL_FEED_BITE_MM,
  WALL_FEED_PITCH_RAD,
  boardTopY,
  bodyCollisionPadMm,
  contactRadiusAt,
  contactRadiusMm,
  extendedLabellumReachAt,
  mm,
  pitchedTipAt,
  standoffAt,
  standoffMm,
} from '../../src/scene/scale.ts';
import { wallFeedLiftAt, wallFeedLiftMm } from '../../src/body/wallFeed.ts';

const dt = 1 / 60;
/** Director tests stand the root 2 mm above the support (see makeDirector). */
const ROOT_STAND = 2;

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
      const approach = sys.approachTarget(pos, food);
      // Real geometry: measured extended tip, pitched by the wall-feeding
      // posture, on a root standing ROOT_STAND + lift above the board.
      const tip = pitchedTipAt(FLY_RENDER_SCALE, WALL_FEED_PITCH_RAD);
      const rootY = boardTopY() + ROOT_STAND + wallFeedLiftMm();
      const labellum = {
        x: pos.x + Math.sin(heading) * tip.z - food.x,
        y: rootY + tip.y - food.y,
        z: pos.z + Math.cos(heading) * tip.z - food.z,
      };
      const toHit = Math.hypot(pos.x + Math.sin(heading) * tip.z - approach.hit.x, pos.z + Math.cos(heading) * tip.z - approach.hit.z);
      expect(toHit).toBeLessThanOrEqual(contactRadiusMm() + APPROACH_ARRIVE_MM);
      // The tip is inside the wall plane (contact), above the board, below the top face.
      expect(labellum.y).toBeGreaterThan(boardTopY() - food.y);
      expect(labellum.y).toBeLessThan(sys.hy);
      const chunk = sys.nearestUneaten(labellum, sys.contactReachMm());
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

  it('reaches a surface chunk in TASTE at 0.5×, 1× and 2× FLY_RENDER_SCALE', () => {
    const layout = kitchenLayout();
    const food = { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z };
    const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
    for (const mul of [0.5, 1, 2] as const) {
      const scale = FLY_RENDER_SCALE * mul;
      const stand = standoffAt(scale);
      const tip = pitchedTipAt(scale, WALL_FEED_PITCH_RAD);
      const rootY = boardTopY() + ROOT_STAND + wallFeedLiftAt(scale);
      const parked = { x: food.x, y: rootY, z: food.z - sys.hz - stand };
      const heading = 0;
      const approach = sys.approachTarget(parked, food, stand);
      expect(approach.arrived || approach.distance <= 1e-6).toBe(true);
      const labellum = {
        x: parked.x + Math.sin(heading) * tip.z - food.x,
        y: rootY + tip.y - food.y,
        z: parked.z + Math.cos(heading) * tip.z - food.z,
      };
      // Pitched tip sinks WALL_FEED_BITE_MM into the face at every scale.
      const tipOnHit = Math.hypot(
        parked.x + Math.sin(heading) * tip.z - approach.hit.x,
        parked.z + Math.cos(heading) * tip.z - approach.hit.z,
      );
      expect(tipOnHit).toBeCloseTo(WALL_FEED_BITE_MM, 6);
      // Flat (unpitched) reach would NOT arrive — that was the old bug.
      expect(extendedLabellumReachAt(scale)).toBeLessThan(stand);
      const radius = contactRadiusAt(scale) + 2 * sys.chunkHalfExtentMm();
      expect(sys.nearestUneaten(labellum, radius), `scale ${scale}`).not.toBeNull();
    }
  });
});
