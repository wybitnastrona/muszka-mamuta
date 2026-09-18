import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { millConsoleReachPose, millRailReachPose } from '../../src/body/bipedGait.ts';
import { kitchenFrame, millSideFrame } from '../../src/body/cameras.ts';
import {
  MILL_BELT_H,
  MILL_CHAMFER_MM,
  MILL_INCLINE_RAD,
  MILL_PLINTH_H,
  MILL_ROLLER_R,
  createTreadmill,
  millBaseHeightMm,
  millBeltCenterLocalY,
  millBeltTopLocalY,
  millConsoleGripLocalY,
  millConsoleGripWorld,
  millConsoleLocalPose,
  millStandXz,
  millSurfaceY,
} from '../../src/body/treadmill.ts';
import { MILL_GAP_MM, kitchenLayout, millCentreX } from '../../src/scene/layout.ts';
import { MILL_MM, flyVisualLengthMm, mm } from '../../src/scene/scale.ts';

describe('lab mill geometry', () => {
  it('puts the belt top tangent to the roller tops', () => {
    const mill = createTreadmill();
    const belt = mill.group.getObjectByName('millBelt') as THREE.Mesh;
    const front = mill.group.getObjectByName('millRollerFront') as THREE.Mesh;
    const back = mill.group.getObjectByName('millRollerBack') as THREE.Mesh;
    const beltTop = belt.position.y + MILL_BELT_H / 2;
    const frontTop = front.position.y + MILL_ROLLER_R;
    const backTop = back.position.y + MILL_ROLLER_R;
    expect(belt.position.y).toBeCloseTo(millBeltCenterLocalY(), 5);
    expect(millBeltCenterLocalY()).toBeCloseTo(12 + 4.2 - 1.1, 5);
    expect(beltTop).toBeCloseTo(frontTop, 5);
    expect(beltTop).toBeCloseTo(backTop, 5);
    expect(Math.abs(beltTop - frontTop)).toBeLessThan(0.05);
    expect(beltTop).toBeCloseTo(16.2, 5);
    mill.dispose();
  });

  it('uses millSurfaceY as the belt top, monotonic uphill along +X', () => {
    const mill = kitchenLayout().mill;
    const stand = millStandXz();
    expect(millSurfaceY(stand.x)).toBeCloseTo(millSurfaceY(stand.x, millBeltTopLocalY()), 8);
    const xs = [-0.9, -0.45, 0, 0.45, 0.9].map((f) => mill.x + mill.hx * f);
    const ys = xs.map((x) => millSurfaceY(x));
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
    }
    const rise = millSurfaceY(mill.x + mill.hx) - millSurfaceY(mill.x - mill.hx);
    expect(rise).toBeCloseTo(mm(MILL_MM.length) * Math.sin(MILL_INCLINE_RAD), 5);
  });

  it('keeps MILL_GAP_MM between the tub rim and the mill −X face', () => {
    const { tub, mill } = kitchenLayout();
    expect(mill.x).toBeCloseTo(millCentreX(), 8);
    const tubRim = tub.x + tub.diameter / 2;
    const millFace = mill.x - mill.hx;
    expect(millFace - tubRim).toBeCloseTo(MILL_GAP_MM, 5);
    expect(millFace - tubRim).toBeGreaterThan(0);
  });

  it('builds a chamfered 16 mm plinth, not a 7.2 mm sliver', () => {
    expect(millBaseHeightMm()).toBe(MILL_PLINTH_H);
    expect(millBaseHeightMm()).toBeGreaterThanOrEqual(16);
    expect(millBaseHeightMm()).toBeLessThanOrEqual(20);
    const mill = createTreadmill();
    const base = mill.group.getObjectByName('millBase') as THREE.Mesh;
    base.geometry.computeBoundingBox();
    const box = base.geometry.boundingBox!;
    expect(box.max.y - box.min.y).toBeCloseTo(MILL_PLINTH_H, 1);
    expect(MILL_CHAMFER_MM).toBe(2);
    mill.dispose();
  });

  it('faces the console screen into the kitchen-camera hemisphere', () => {
    const mill = createTreadmill();
    mill.group.updateMatrixWorld(true);
    const screen = mill.group.getObjectByName('millConsoleScreen') as THREE.Mesh;
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(screen.getWorldQuaternion(new THREE.Quaternion()));
    const screenPos = new THREE.Vector3();
    screen.getWorldPosition(screenPos);
    const cam = kitchenFrame();
    const toCam = new THREE.Vector3(cam.position[0], cam.position[1], cam.position[2]).sub(screenPos);
    expect(n.z).toBeLessThan(0);
    expect(n.dot(toCam)).toBeGreaterThan(0);
    const pose = millConsoleLocalPose();
    expect(pose.width).toBeCloseTo(flyVisualLengthMm() * 1.4, 5);
    expect(pose.depth).toBeCloseTo(flyVisualLengthMm() * 0.72, 5);
    mill.dispose();
  });

  it('places lean-bar grips above the belt within foreleg reach of the stand', () => {
    const stand = millStandXz();
    const grip = millConsoleGripWorld();
    const beltY = millSurfaceY(stand.x);
    expect(grip.left.y).toBeGreaterThan(beltY);
    expect(grip.right.y).toBeGreaterThan(beltY);
    expect(millConsoleGripLocalY()).toBeGreaterThan(millBeltTopLocalY());
    const fly = flyVisualLengthMm();
    for (const p of [grip.left, grip.right]) {
      const reach = Math.hypot(p.x - stand.x, p.y - beltY, p.z - stand.z);
      expect(reach).toBeLessThan(fly);
      expect(reach).toBeGreaterThan(fly * 0.2);
    }
  });

  it('parameterises the biped gag from millConsoleGripWorld, not a hard-coded rail', () => {
    const fromConsole = millConsoleReachPose();
    const aliased = millRailReachPose();
    expect(fromConsole.foreleg_L_tarsus).toEqual(aliased.foreleg_L_tarsus);
    expect(fromConsole.foreleg_L_tarsus).toBeDefined();
  });

  it('pitches with rotation.z (local +X uphill), not rotation.y', () => {
    const mill = createTreadmill();
    expect(mill.group.rotation.order).toBe('XYZ');
    expect(mill.group.rotation.z).toBeCloseTo(MILL_INCLINE_RAD, 8);
    expect(mill.group.rotation.x).toBeCloseTo(0, 8);
    mill.dispose();
  });

  it('puts millSideFrame on +Z looking at the deck (Z boku elevation)', () => {
    const mill = kitchenLayout().mill;
    const frame = millSideFrame();
    expect(frame.position[2]).toBeGreaterThan(mill.z + 100);
    expect(frame.lookAt[0]).toBeGreaterThan(mill.x - 1);
    expect(frame.lookAt[1]).toBeGreaterThan(millSurfaceY(mill.x) - 8);
  });
});
