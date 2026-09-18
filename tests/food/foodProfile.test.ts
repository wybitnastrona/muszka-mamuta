import { describe, expect, it } from 'vitest';
import {
  CREATINE_KFD,
  TWAROG_MAMUTA_WANILIOWY,
  TWAROG_PLAIN_UNSWEETENED,
} from '../../src/food/foodProfile.ts';

describe('CREATINE_KFD', () => {
  it('is the authored live profile: aa-heavy, almost unsweetened', () => {
    expect(CREATINE_KFD.sweet).toBe(0.05);
    expect(CREATINE_KFD.aa).toBe(0.85);
    expect(CREATINE_KFD.bitter).toBeLessThan(0.15);
    expect(CREATINE_KFD.odor).toBeGreaterThan(0);
    expect(CREATINE_KFD.albedoHex).toBe('#f2f4f6');
  });
});

describe('TWAROG_MAMUTA_WANILIOWY', () => {
  it('is the authored vanilla-sweetened fixture, not the live food', () => {
    expect(TWAROG_MAMUTA_WANILIOWY).toEqual({
      sweet: 0.75,
      aa: 0.70,
      sour: 0.25,
      bitter: 0.03,
      odor: 0.85,
      albedoHex: '#e1d7ca',
    });
  });

  it('keeps a plain-curd comparison fixture at sweet 0.15', () => {
    expect(TWAROG_PLAIN_UNSWEETENED.sweet).toBe(0.15);
    expect(TWAROG_PLAIN_UNSWEETENED.aa).toBe(TWAROG_MAMUTA_WANILIOWY.aa);
  });
});
