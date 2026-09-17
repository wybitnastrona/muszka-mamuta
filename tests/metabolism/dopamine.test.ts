/** Audit-only: src/metabolism/dopamine.ts is unused in the app. */
import { describe, expect, it } from 'vitest';
import {
  COURTSHIP_TONE_MIN,
  DOPAMINE_TAU_S,
  DopamineTone,
  NAP_TONE_MAX,
  PAM_REF_HZ,
  PUMP_RATE_TONE_GAIN,
  pumpRateScale,
} from '../../src/metabolism/dopamine.ts';

describe('DopamineTone', () => {
  it('integrates pamRate toward PAM_REF without injecting on bite', () => {
    expect(PAM_REF_HZ).toBeCloseTo(0.842, 3);
    expect(DOPAMINE_TAU_S).toBe(4);
    const d = new DopamineTone();
    d.onBite(0.01, { x: 1, y: 2, z: 3 }, 1.2);
    expect(d.tone).toBe(0);
    expect(d.lastBite?.massGrams).toBe(0.01);
    const dt = 0.05;
    for (let t = 0; t < DOPAMINE_TAU_S; t += dt) d.step(dt, PAM_REF_HZ);
    expect(d.tone).toBeGreaterThan(0.6);
    expect(d.tone).toBeLessThan(0.7);
    for (let t = 0; t < 20; t += dt) d.step(dt, PAM_REF_HZ);
    expect(d.display()).toBeGreaterThan(0.99);
  });

  it('scales pump rate by at most +25% and lists authored gates', () => {
    expect(pumpRateScale(0)).toBe(1);
    expect(pumpRateScale(1)).toBe(1 + PUMP_RATE_TONE_GAIN);
    expect(PUMP_RATE_TONE_GAIN).toBe(0.25);
    expect(NAP_TONE_MAX).toBe(0.3);
    expect(COURTSHIP_TONE_MIN).toBe(0.5);
  });
});
