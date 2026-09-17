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
  MILL_MM,
  PILE_MM,
  POUCH_INNER_MM,
  POUCH_MM,
  REAL_FLY_BODY_MM,
  SEAL_MM,
  WALL_FEED_BITE_MM,
  WALL_FEED_PITCH_RAD,
  bodyCollisionPadMm,
  boardTopY,
  contactRadiusMm,
  crumbSizeMm,
  extendedLabellumReachMm,
  flyRootScale,
  flyVisualHalfLengthMm,
  flyVisualLengthMm,
  foodStandPadMm,
  lodDistanceMm,
  lodFadeSec,
  mm,
  pitchedTipAt,
  standoffMm,
  proboscisReachMm,
} from '../../src/scene/scale.ts';
import { closeupOffset, reelFrame } from '../../src/body/cameras.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';

describe('scene scale', () => {
  it('uses one millimetre per scene unit at 6× render scale', () => {
    expect(mm(100)).toBe(100);
    expect(FLY_RENDER_SCALE).toBe(6);
    expect(flyVisualLengthMm()).toBe(15);
    expect(flyVisualLengthMm()).toBe(REAL_FLY_BODY_MM * FLY_RENDER_SCALE);
    expect(flyVisualLengthMm() / CURD_MM.length).toBeCloseTo(0.15);
    // Half the block height: visible on a reel, block still reads as a block.
    expect(flyVisualLengthMm() / CURD_MM.height).toBeCloseTo(0.5);
    expect(flyRootScale()).toBeGreaterThan(1);
    expect(BOARD_MM).toEqual({ length: 400, width: 300, height: 40 });
    expect(BOARD_EDGE_RADIUS_MM).toBe(6);
    expect(BOARD_YAW_DEG).toBe(12);
    expect(boardTopY()).toBe(40);
    expect(PILE_MM).toEqual({ radius: 20, height: 14 });
    expect(MILL_MM.length).toBe(120);
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
    // Standoff is the wall-feeding distance: the measured, pitched tip sinks
    // WALL_FEED_BITE_MM into a vertical face. It is far shorter than the old
    // "half body + proboscis" guess because the real extended reach is ~4.5 mm.
    expect(standoffMm()).toBeCloseTo(pitchedTipAt(FLY_RENDER_SCALE, WALL_FEED_PITCH_RAD).z - WALL_FEED_BITE_MM);
    expect(extendedLabellumReachMm()).toBeLessThan(flyVisualHalfLengthMm());
    expect(proboscisReachMm()).toBeGreaterThan(0);
    expect(bodyCollisionPadMm()).toBeCloseTo(flyVisualHalfLengthMm());
    expect(standoffMm()).toBeGreaterThan(foodStandPadMm());
    expect(foodStandPadMm()).toBeLessThan(bodyCollisionPadMm());
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
    expect(Math.hypot(reel.position[0] - layout.pile.x, reel.position[2] - layout.pile.z)).toBeGreaterThan(200);
    expect(layout.pile.x).toBeLessThan(layout.scoop.x);
    expect(layout.scoop.x).toBeLessThan(layout.mill.x);
    expect(layout.tubSlot.diameter).toBe(layout.tub.diameter);
    expect(layout.tub.x).toBe(layout.pile.x);
  });
});
