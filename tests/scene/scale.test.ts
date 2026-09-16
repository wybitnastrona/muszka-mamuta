import { describe, expect, it } from 'vitest';
import {
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
  contactRadiusMm,
  flyRootScale,
  flyVisualHalfLengthMm,
  flyVisualLengthMm,
  lodDistanceMm,
  lodFadeSec,
  mm,
  standoffMm,
  proboscisReachMm,
} from '../../src/scene/scale.ts';

describe('scene scale', () => {
  it('uses one millimetre per scene unit at render scale', () => {
    expect(mm(100)).toBe(100);
    expect(flyVisualLengthMm()).toBe(REAL_FLY_BODY_MM * FLY_RENDER_SCALE);
    expect(flyRootScale()).toBeGreaterThan(1);
  });

  it('derives pouch inner size from curd plus seals', () => {
    expect(POUCH_MM.length).toBe(CURD_MM.length + 2 * SEAL_MM);
    expect(POUCH_MM.width).toBe(CURD_MM.width + 2 * SEAL_MM);
    expect(POUCH_INNER_MM.length).toBe(CURD_MM.length);
    expect(POUCH_INNER_MM.width).toBe(CURD_MM.width);
    expect(CURD_ALBEDO_HEX).toBe('#e1d7ca');
  });

  it('derives contact and LOD distances from visual body length', () => {
    expect(contactRadiusMm()).toBeCloseTo(flyVisualLengthMm() * CONTACT_RADIUS_BODY_LENGTHS);
    expect(lodDistanceMm()).toBeCloseTo(flyVisualLengthMm() * LOD_BODY_LENGTHS);
    expect(lodFadeSec()).toBeCloseTo(LOD_FADE_MS / 1000);
    expect(CONTACT_RADIUS_BODY_LENGTHS).toBe(0.3);
    expect(LOD_BODY_LENGTHS).toBe(3);
    expect(ETERNITY_MASS_FRAC).toBe(0.05);
  });

  it('sets standoff to half body length plus extended proboscis reach', () => {
    expect(flyVisualHalfLengthMm()).toBeCloseTo(flyVisualLengthMm() / 2);
    expect(standoffMm()).toBeCloseTo(flyVisualHalfLengthMm() + proboscisReachMm());
    expect(bodyCollisionPadMm()).toBeCloseTo(flyVisualHalfLengthMm());
    expect(standoffMm()).toBeGreaterThan(bodyCollisionPadMm());
  });
});
