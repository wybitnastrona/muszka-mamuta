import { describe, expect, it } from 'vitest';
import {
  BOARD_EDGE_RADIUS_MM,
  BOARD_MM,
  BOARD_YAW_DEG,
  CONTACT_RADIUS_BODY_LENGTHS,
  CURD_ALBEDO_HEX,
  CURD_MM,
  ETERNITY_MASS_FRAC,
  FLY_RENDER_SCALE,
  LOD_BODY_LENGTHS,
  LOD_FADE_MS,
  POUCH_INNER_MM,
  POUCH_MM,
  REAL_FLY_BODY_MM,
  SEAL_MM,
  bodyCollisionPadMm,
  boardTopY,
  contactRadiusMm,
  crumbSizeMm,
  flyRootScale,
  flyVisualHalfLengthMm,
  flyVisualLengthMm,
  lodDistanceMm,
  lodFadeSec,
  mm,
  standoffMm,
  proboscisReachMm,
} from '../../src/scene/scale.ts';
import { closeupOffset, reelFrame } from '../../src/body/cameras.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';

describe('scene scale', () => {
  it('uses one millimetre per scene unit at 4× render scale', () => {
    expect(mm(100)).toBe(100);
    expect(FLY_RENDER_SCALE).toBe(4);
    expect(flyVisualLengthMm()).toBe(10);
    expect(flyVisualLengthMm()).toBe(REAL_FLY_BODY_MM * FLY_RENDER_SCALE);
    expect(flyVisualLengthMm() / CURD_MM.length).toBeCloseTo(0.1);
    expect(flyRootScale()).toBeGreaterThan(1);
    expect(BOARD_MM).toEqual({ length: 400, width: 300, height: 40 });
    expect(BOARD_EDGE_RADIUS_MM).toBe(6);
    expect(BOARD_YAW_DEG).toBe(12);
    expect(boardTopY()).toBe(40);
  });

  it('derives pouch inner size from curd plus seals', () => {
    expect(POUCH_MM.length).toBe(CURD_MM.length + 2 * SEAL_MM);
    expect(POUCH_MM.width).toBe(CURD_MM.width + 2 * SEAL_MM);
    expect(POUCH_INNER_MM.length).toBe(CURD_MM.length);
    expect(POUCH_INNER_MM.width).toBe(CURD_MM.width);
    expect(CURD_ALBEDO_HEX).toBe('#e1d7ca');
  });

  it('derives contact, LOD, standoff, padding and crumbs from visual body length', () => {
    expect(contactRadiusMm()).toBeCloseTo(flyVisualLengthMm() * CONTACT_RADIUS_BODY_LENGTHS);
    expect(lodDistanceMm()).toBeCloseTo(flyVisualLengthMm() * LOD_BODY_LENGTHS);
    expect(lodFadeSec()).toBeCloseTo(LOD_FADE_MS / 1000);
    expect(CONTACT_RADIUS_BODY_LENGTHS).toBe(0.3);
    expect(LOD_BODY_LENGTHS).toBe(3);
    expect(ETERNITY_MASS_FRAC).toBe(0.05);
    expect(flyVisualHalfLengthMm()).toBeCloseTo(flyVisualLengthMm() / 2);
    expect(standoffMm()).toBeCloseTo(flyVisualHalfLengthMm() + proboscisReachMm());
    expect(bodyCollisionPadMm()).toBeCloseTo(flyVisualHalfLengthMm());
    expect(standoffMm()).toBeGreaterThan(bodyCollisionPadMm());
    expect(crumbSizeMm()).toBeCloseTo(flyVisualLengthMm() * 0.08);
  });

  it('scales Zbliżenie with the fly and keeps Reel on the kitchen', () => {
    const half = flyVisualLengthMm() / 2;
    const close = closeupOffset(half);
    const dist = Math.hypot(close[0], close[1], close[2]);
    expect(dist).toBeGreaterThan(half);
    expect(dist).toBeLessThan(flyVisualLengthMm() * 2);
    const layout = kitchenLayout();
    const reel = reelFrame(half);
    expect(reel.position[1]).toBeGreaterThan(8);
    expect(Math.hypot(reel.position[0] - layout.curd.x, reel.position[2] - layout.curd.z)).toBeGreaterThan(200);
  });
});
