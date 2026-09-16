import { describe, expect, it } from 'vitest';
import {
  TWAROG_MAMUTA_WANILIOWY,
  TWAROG_PLAIN_UNSWEETENED,
} from '../../src/food/foodProfile.ts';

describe('TWAROG_MAMUTA_WANILIOWY', () => {
  it('is the authored vanilla-sweetened profile', () => {
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
