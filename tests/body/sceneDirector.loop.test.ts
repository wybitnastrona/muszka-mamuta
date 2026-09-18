import { describe, expect, it } from 'vitest';
import { SceneDirector } from '../../src/body/sceneDirector.ts';
import { BIPED_BODY_PITCH_RAD, bipedStandLiftMm } from '../../src/body/bipedGait.ts';
import { EAT_SCOOP_MAX_BITES, EAT_SCOOP_MIN_BITES, isEatState, isSplineFlight, LOOP_STATES, type LoopVariant } from '../../src/body/sceneLoop.ts';
import { kitchenLayout, scoopEatStand, scoopTableStand } from '../../src/scene/layout.ts';
import { FLY_WALK_MM_S, MILL_WALK_MM_S, flyVisualLengthMm, powderLandingYMm, tableTopY } from '../../src/scene/scale.ts';
import { CreatineSystem } from '../../src/food/creatineSystem.ts';
import { millStandXz, millSurfaceY, MILL_HEADING } from '../../src/body/treadmill.ts';
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

function onMillFootprint(x: number, z: number): boolean {
  const mill = kitchenLayout().mill;
  return Math.abs(x - mill.x) <= mill.hx && Math.abs(z - mill.z) <= mill.hz;
}

describe('SceneDirector scripted loop (reel)', () => {
  it('spawns flying into the tub with the scoop already in the well', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    const out = d.update(drive);
    expect(out.macro).toBe('FLY_INTO_TUB');
    expect(out.mode).toBe('flight');
    expect(out.scoop?.mode).toBe('well');
    expect(out.scoop?.fill).toBeGreaterThan(0);
    expect(d.position.y).toBeGreaterThan(tableTopY());
    expect(Math.hypot(d.position.x - layout.tub.x, d.position.z - layout.tub.z)).toBeLessThan(120);
  });

  it('picks up the scoop in the well and PUMPs from the held bowl', () => {
    const d = makeLoopDirector();
    const food = d.food as CreatineSystem;
    const before = food.remainingMassGrams;
    let sawPick = false;
    let sawTaste = false;
    let sawPump = false;
    let pumpAa = 0;
    for (let i = 0; i < 30 * 90; i++) {
      const out = d.update({ ...drive, satiety: 0.2 });
      if (out.macro === 'PICK_SCOOP') {
        sawPick = true;
        expect(out.scoop?.mode).toBe('held');
        expect(food.scoopFill).toBeGreaterThan(0);
        expect(food.remainingMassGrams).toBeLessThanOrEqual(before);
      }
      if (out.macro === 'EAT_SCOOP') {
        expect(out.scoop?.mode).toBe('held');
        if (d.fsm.state === 'TASTE' || d.fsm.state === 'EXTEND') sawTaste = true;
        if (d.fsm.state === 'PUMP') {
          sawPump = true;
          pumpAa = Math.max(pumpAa, out.chemo?.contact.aa ?? 0);
          expect(out.heldCrumb).toBeNull();
        }
      }
      if (sawPump && (out.macro === 'DROP_SCOOP' || out.macro === 'GROOM_SHORT')) break;
    }
    expect(sawPick).toBe(true);
    expect(sawTaste).toBe(true);
    expect(sawPump).toBe(true);
    expect(pumpAa).toBeGreaterThan(0.3);
    expect(isEatState('EAT_SCOOP')).toBe(true);
  });

  it('reaches AUTONOMOUS at seed 1 without ORBIT / EXIT_FRAME', () => {
    const d = makeLoopDirector();
    const seen: string[] = [];
    for (let i = 0; i < 8000; i++) {
      const out = d.update(drive);
      if (!seen.includes(out.macro)) seen.push(out.macro);
      if (out.macro === 'AUTONOMOUS' && i > 200) break;
    }
    for (const state of [
      'FLY_INTO_TUB', 'PICK_SCOOP', 'EAT_SCOOP', 'FLY_OUT_WITH_SCOOP',
      'LAND_MILL', 'WALK_BIPED_ON_MILL', 'AUTONOMOUS',
    ] as const) {
      expect(seen, state).toContain(state);
    }
    expect(seen).not.toContain('ORBIT');
    expect(seen).not.toContain('EXIT_FRAME');
    expect(LOOP_STATES.length).toBeGreaterThan(8);
  });

  it('walks in place on the mill: belt gait, root ΔXZ ≈ 0, heading along +X', () => {
    const d = makeLoopDirector();
    const stand = millStandXz();
    let millFrames = 0;
    let dx = 0;
    let lastX = stand.x;
    let lastZ = stand.z;
    for (let i = 0; i < 8000; i++) {
      const out = d.update(drive);
      if (out.macro !== 'WALK_BIPED_ON_MILL') continue;
      millFrames += 1;
      dx += Math.hypot(d.position.x - lastX, d.position.z - lastZ);
      lastX = d.position.x;
      lastZ = d.position.z;
      expect(out.mode).toBe('mill');
      expect(d.heading).toBeCloseTo(MILL_HEADING, 5);
      expect(Math.hypot(d.position.x - stand.x, d.position.z - stand.z)).toBeLessThan(1);
      if (millFrames > 20) break;
    }
    expect(millFrames).toBeGreaterThan(10);
    expect(dx / millFrames).toBeLessThan(1);
    expect(FLY_WALK_MM_S).toBe(14);
    expect(MILL_WALK_MM_S).toBe(4.5);
  });

  it('pitches up for the authored biped gag', () => {
    const d = makeLoopDirector();
    let frames = 0;
    const mill = kitchenLayout().mill;
    for (let i = 0; i < 8000; i++) {
      const out = d.update(drive);
      if (out.macro !== 'WALK_BIPED_ON_MILL') continue;
      frames += 1;
      expect(out.mode).toBe('mill');
      expect(Math.abs(out.flyPose.pitch)).toBeGreaterThan(Math.abs(BIPED_BODY_PITCH_RAD) * 0.8);
      expect(out.flyPose.pose.foreleg_L_tarsus).toBeDefined();
      expect(d.position.y).toBeGreaterThan(mill.deckY);
      expect(d.position.y).toBeLessThan(millSurfaceY(millStandXz().x) + bipedStandLiftMm() + 6);
      if (frames > 8) break;
    }
    expect(frames).toBeGreaterThan(5);
  });

  it('keeps the up vector within 35° of +Y except during takeoff2 and the biped gag', () => {
    const d = makeLoopDirector();
    const upN = { x: 0, y: 1, z: 0 };
    for (let i = 0; i < 4000; i++) {
      const out = d.update(drive);
      if (d.flight.kind === 'takeoff2' || out.macro === 'WALK_BIPED' || out.macro === 'WALK_BIPED_ON_MILL') continue;
      const up = bodyUpAxis(out.flyPose.pitch, out.flyPose.heading, out.flyPose.bank + out.flyPose.roll);
      expect(tiltFromNormal(up, upN)).toBeLessThanOrEqual(UP_ALIGN_MAX_RAD + 0.08);
      if (out.macro === 'AUTONOMOUS') break;
    }
  });

  it('flies through the tub AABB only on authored well splines', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    const origin = { x: layout.pile.x, y: layout.pile.y, z: layout.pile.z };
    const box = { cx: origin.x, cy: origin.y, cz: origin.z, hx: d.food.hx, hy: d.food.hy, hz: d.food.hz };
    const seen = new Set<string>();
    let enteredWell = false;
    for (let i = 0; i < 5000; i++) {
      const out = d.update(drive);
      seen.add(out.mode);
      if (out.mode === 'flight') {
        const inside = pointInAabb3(d.position, box, -0.05);
        const ghost = isSplineFlight(out.macro) || out.macro === 'PICK_SCOOP' || out.macro === 'AUTONOMOUS';
        if (ghost) {
          if (inside) enteredWell = true;
        } else {
          expect(inside).toBe(false);
        }
      }
      if (seen.has('flight') && seen.has('mill') && seen.has('ground')) break;
    }
    expect(seen.has('flight')).toBe(true);
    expect(seen.has('mill')).toBe(true);
    expect(seen.has('ground')).toBe(true);
    expect(enteredWell).toBe(true);
    expect(flyVisualLengthMm()).toBe(15);
  });

  it('eats on the table beside the tub, then takes off to the mill even if MN9 is quiet', () => {
    const d = makeLoopDirector();
    const layout = kitchenLayout();
    const table = scoopTableStand();
    const well = scoopEatStand();
    const box = {
      cx: layout.tub.x, cy: layout.tub.y, cz: layout.tub.z,
      hx: d.food.hx, hy: d.food.hy, hz: d.food.hz,
    };
    const seen: string[] = [];
    let pickInWell = false;
    let eatDist = 0;
    let eatHeading = 0;
    let eatHeadingLocked = false;
    for (let i = 0; i < 8000; i++) {
      const out = d.update({ ...drive, mn9Rate: 0.8, satiety: 0.32 });
      if (!seen.includes(out.macro)) seen.push(out.macro);
      if (out.macro === 'PICK_SCOOP') {
        pickInWell = Math.hypot(d.position.x - layout.tub.x, d.position.z - layout.tub.z)
          < layout.tub.innerRadius;
        expect(Math.abs(d.position.x - well.x)).toBeLessThan(12);
        expect(d.position.y).toBeCloseTo(powderLandingYMm() + 2, 5);
      }
      if (out.macro === 'EAT_SCOOP') {
        eatDist = Math.hypot(d.position.x - table.x, d.position.z - table.z);
        if (!eatHeadingLocked) {
          eatHeading = d.heading;
          eatHeadingLocked = true;
        }
        expect(eatDist).toBeLessThan(flyVisualLengthMm());
        expect(pointInAabb3(d.position, box, -0.05)).toBe(false);
        expect(d.position.y).toBeCloseTo(tableTopY() + 2, 5);
      }
      if (out.macro === 'WALK_BIPED_ON_MILL') break;
    }
    expect(pickInWell).toBe(true);
    expect(eatDist).toBeLessThan(flyVisualLengthMm());
    expect(eatHeading).toBeCloseTo(table.heading, 1);
    expect(seen).toContain('FLY_OUT_WITH_SCOOP');
    expect(seen).toContain('TAKEOFF_MILL');
    expect(seen).toContain('LAND_MILL');
    expect(seen).toContain('WALK_BIPED_ON_MILL');
    expect(seen.indexOf('FLY_OUT_WITH_SCOOP')).toBeGreaterThan(seen.indexOf('PICK_SCOOP'));
    expect(seen.indexOf('EAT_SCOOP')).toBeGreaterThan(seen.indexOf('FLY_OUT_WITH_SCOOP'));
    expect(seen.indexOf('TAKEOFF_MILL')).toBeGreaterThan(seen.indexOf('EAT_SCOOP'));
    expect(seen.indexOf('WALK_BIPED_ON_MILL')).toBeGreaterThan(seen.indexOf('EAT_SCOOP'));
  });

  it('lands FLY_OUT_WITH_SCOOP on the table, caps EAT_SCOOP at 1–3 bites, and stays off the mill until TAKEOFF_MILL', () => {
    const d = makeLoopDirector();
    const table = scoopTableStand();
    const seen: string[] = [];
    let flyOutXz = Infinity;
    let flyOutY = 99;
    let eatBites = 0;
    let leftEat = false;
    for (let i = 0; i < 8000; i++) {
      const out = d.update({ ...drive, satiety: 0.3 });
      if (!seen.includes(out.macro)) seen.push(out.macro);
      const beforeTakeoff = !seen.includes('TAKEOFF_MILL') && out.macro !== 'TAKEOFF_MILL';
      if (beforeTakeoff) {
        expect(onMillFootprint(d.position.x, d.position.z), out.macro).toBe(false);
      }
      if (out.macro === 'FLY_OUT_WITH_SCOOP') {
        flyOutXz = Math.hypot(d.position.x - table.x, d.position.z - table.z);
        flyOutY = d.position.y;
      }
      if (out.macro === 'EAT_SCOOP') {
        eatBites = Math.max(eatBites, out.bites);
        for (const ev of out.events) {
          if (ev.type === 'bite') eatBites = Math.max(eatBites, ev.cycle);
        }
        expect(Math.hypot(d.position.x - table.x, d.position.z - table.z)).toBeLessThan(flyVisualLengthMm());
        expect(d.position.y).toBeCloseTo(tableTopY() + 2, 5);
      }
      if (seen.includes('EAT_SCOOP') && out.macro !== 'EAT_SCOOP' && !leftEat) {
        leftEat = true;
        expect(eatBites).toBeGreaterThanOrEqual(EAT_SCOOP_MIN_BITES);
        expect(eatBites).toBeLessThanOrEqual(EAT_SCOOP_MAX_BITES);
      }
      if (out.macro === 'WALK_BIPED_ON_MILL') break;
    }
    expect(flyOutXz).toBeLessThan(flyVisualLengthMm());
    expect(flyOutY).toBeGreaterThanOrEqual(tableTopY());
    expect(flyOutY).toBeLessThan(tableTopY() + 8);
    expect(leftEat).toBe(true);
    expect(eatBites).toBeGreaterThanOrEqual(EAT_SCOOP_MIN_BITES);
    expect(eatBites).toBeLessThanOrEqual(EAT_SCOOP_MAX_BITES);
    expect(seen.indexOf('TAKEOFF_MILL')).toBeGreaterThan(seen.indexOf('EAT_SCOOP'));
  });

  it('lands hexapod on the belt then stands for the biped gag', () => {
    const d = makeLoopDirector();
    let landPitch = 99;
    let landY = 0;
    let millDist = 0;
    const standY = millSurfaceY(millStandXz().x);
    for (let i = 0; i < 8000; i++) {
      const out = d.update(drive);
      if (out.macro === 'LAND_MILL') {
        landPitch = out.flyPose.pitch;
        landY = d.position.y;
      }
      if (out.macro === 'WALK_BIPED_ON_MILL') {
        millDist = out.millDistanceMm;
        expect(Math.abs(landPitch)).toBeLessThan(0.35);
        expect(landY).toBeLessThan(standY + 4);
        expect(d.position.y).toBeGreaterThan(standY - 1);
        if (out.millDistanceMm > MILL_WALK_MM_S * 0.2) break;
      }
    }
    expect(millDist).toBeGreaterThan(0);
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
