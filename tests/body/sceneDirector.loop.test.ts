import { describe, expect, it } from 'vitest';
import { SceneDirector } from '../../src/body/sceneDirector.ts';
import { BIPED_BODY_PITCH_RAD } from '../../src/body/bipedGait.ts';
import { isEatState, LOOP_STATES, type LoopVariant } from '../../src/body/sceneLoop.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';
import { FLY_WALK_MM_S, flyVisualLengthMm, tableTopY } from '../../src/scene/scale.ts';
import { CreatineSystem } from '../../src/food/creatineSystem.ts';
import { UP_ALIGN_MAX_RAD, bodyUpAxis, pointInAabb3, tiltFromNormal } from '../../src/body/collision.ts';

function makeLoopDirector(variant: LoopVariant = 'reel') {
  const layout = kitchenLayout();
  const food = CreatineSystem.create({ seed: 1, store: null });
  return new SceneDirector({
    food,
    foodOrigin: { x: layout.pile.x, y: layout.pile.y, z: layout.pile.z },
    pouch: {
      cx: layout.mill.x,
      cz: layout.mill.z,
      hx: layout.mill.hx,
      hz: layout.mill.hz,
      yaw: layout.mill.yaw,
    },
    position: { x: layout.fly.x, y: tableTopY() + 2, z: layout.fly.z },
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

describe('SceneDirector scripted loop (reel)', () => {
  it('spawns walking to the scoop, not on a cheese block', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    const out = d.update(drive);
    expect(out.macro).toBe('WALK_SCOOP');
    expect(out.mode).toBe('ground');
    expect(out.scoop?.mode).toBe('table');
    expect(d.position.y).toBeGreaterThan(tableTopY());
    expect(Math.hypot(d.position.x - layout.scoop.x, d.position.z - layout.scoop.z)).toBeLessThan(80);
  });

  it('picks up the scoop, dips the pile, and PUMPs from the bowl', () => {
    const d = makeLoopDirector();
    const food = d.food as CreatineSystem;
    const before = food.remainingMassGrams;
    let sawPick = false;
    let sawDip = false;
    let sawTaste = false;
    let sawPump = false;
    let pumpAa = 0;
    for (let i = 0; i < 30 * 90; i++) {
      const out = d.update({ ...drive, satiety: 0.2 });
      if (out.macro === 'PICK_SCOOP') {
        sawPick = true;
        expect(out.scoop?.mode).toBe('held');
      }
      if (out.macro === 'DIP_SCOOP') {
        sawDip = true;
        expect(food.scoopFill).toBeGreaterThan(0);
        expect(food.remainingMassGrams).toBeLessThan(before);
      }
      if (out.macro === 'EAT_SCOOP') {
        if (d.fsm.state === 'TASTE' || d.fsm.state === 'EXTEND') sawTaste = true;
        if (d.fsm.state === 'PUMP') {
          sawPump = true;
          pumpAa = Math.max(pumpAa, out.chemo?.contact.aa ?? 0);
          expect(out.heldCrumb).toBeNull();
        }
      }
      if (sawPump && out.macro === 'DROP_SCOOP') break;
    }
    expect(sawPick).toBe(true);
    expect(sawDip).toBe(true);
    expect(sawTaste).toBe(true);
    expect(sawPump).toBe(true);
    expect(pumpAa).toBeGreaterThan(0.3);
    expect(isEatState('EAT_SCOOP')).toBe(true);
  });

  it('completes one reel loop at seed 1 without ORBIT / EXIT_FRAME', () => {
    const d = makeLoopDirector();
    const seen: string[] = [];
    let wrapped = false;
    for (let i = 0; i < 8000; i++) {
      const out = d.update(drive);
      if (out.loopWrapped) wrapped = true;
      if (!seen.includes(out.macro)) seen.push(out.macro);
      if (wrapped && out.macro === 'WALK_SCOOP' && i > 200) break;
    }
    for (const state of [
      'WALK_SCOOP', 'PICK_SCOOP', 'DIP_SCOOP', 'EAT_SCOOP',
      'DROP_SCOOP', 'TAKEOFF_MILL', 'LAND_MILL', 'WALK_MILL', 'WALK_BIPED',
    ] as const) {
      expect(seen, state).toContain(state);
    }
    expect(seen).not.toContain('ORBIT');
    expect(seen).not.toContain('EXIT_FRAME');
    expect(wrapped).toBe(true);
    expect(LOOP_STATES.length).toBeGreaterThan(8);
  });

  it('walks in place on the mill: belt gait, root ΔXZ ≈ 0', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    let millFrames = 0;
    let dx = 0;
    for (let i = 0; i < 8000; i++) {
      const out = d.update(drive);
      if (out.macro !== 'WALK_MILL') continue;
      millFrames += 1;
      dx += Math.hypot(d.position.x - layout.mill.x, d.position.z - layout.mill.z);
      expect(out.mode).toBe('mill');
      expect(d.position.y).toBeCloseTo(layout.mill.deckY + 2, 0);
      if (millFrames > 20) break;
    }
    expect(millFrames).toBeGreaterThan(10);
    expect(dx / millFrames).toBeLessThan(1);
    expect(FLY_WALK_MM_S).toBe(14);
  });

  it('pitches up for the authored biped gag', () => {
    const d = makeLoopDirector();
    let frames = 0;
    for (let i = 0; i < 8000; i++) {
      const out = d.update(drive);
      if (out.macro !== 'WALK_BIPED') continue;
      frames += 1;
      expect(out.mode).toBe('mill');
      expect(Math.abs(out.flyPose.pitch)).toBeGreaterThan(BIPED_BODY_PITCH_RAD * 0.8);
      expect(out.flyPose.pose.foreleg_L_tarsus).toBeDefined();
      if (frames > 8) break;
    }
    expect(frames).toBeGreaterThan(5);
  });

  it('keeps the up vector within 35° of +Y except during takeoff2 and the biped gag', () => {
    const d = makeLoopDirector();
    const upN = { x: 0, y: 1, z: 0 };
    for (let i = 0; i < 4000; i++) {
      const out = d.update(drive);
      if (d.flight.kind === 'takeoff2' || out.macro === 'WALK_BIPED') continue;
      const up = bodyUpAxis(out.flyPose.pitch, out.flyPose.heading, out.flyPose.bank + out.flyPose.roll);
      expect(tiltFromNormal(up, upN)).toBeLessThanOrEqual(UP_ALIGN_MAX_RAD + 0.08);
      if (out.loopWrapped) break;
    }
  });

  it('does not fly through the powder AABB', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    const origin = { x: layout.pile.x, y: layout.pile.y, z: layout.pile.z };
    const box = { cx: origin.x, cy: origin.y, cz: origin.z, hx: d.food.hx, hy: d.food.hy, hz: d.food.hz };
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const out = d.update(drive);
      seen.add(out.mode);
      if (out.mode === 'flight') {
        expect(pointInAabb3(d.position, box, -0.05)).toBe(false);
      }
      if (seen.has('flight') && seen.has('mill') && seen.has('ground')) break;
    }
    expect(seen.has('flight')).toBe(true);
    expect(seen.has('mill')).toBe(true);
    expect(seen.has('ground')).toBe(true);
    expect(flyVisualLengthMm()).toBe(15);
  });
});

describe('SceneDirector scripted loop (full)', () => {
  it('starts in flight (ORBIT) and is pushed out of the mound', () => {
    const d = makeLoopDirector('full');
    const layout = kitchenLayout();
    const box = {
      cx: layout.pile.x, cy: layout.pile.y, cz: layout.pile.z,
      hx: d.food.hx, hy: d.food.hy, hz: d.food.hz,
    };
    const out = d.update(drive);
    expect(out.macro).toBe('ORBIT');
    expect(out.mode).toBe('flight');
    d.position.set(layout.pile.x, layout.pile.y, layout.pile.z);
    d.update(drive);
    expect(pointInAabb3(d.position, box, -0.05)).toBe(false);
    expect(d.mode).toBe('flight');
  });
});
