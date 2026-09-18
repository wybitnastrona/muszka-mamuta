import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_TAU_S,
  PULSE_GAIN_PUMP,
  PULSE_GAIN_REST,
  PULSE_GAIN_RUN,
  PULSE_GAIN_TAU_S,
  easeActivity,
  easeToward,
  pulseTargetGain,
} from '../../src/hud/pulse.ts';

describe('atlas pulse smoothing (presentation only)', () => {
  it('eases displayed activity toward the 10 Hz sample and converges', () => {
    const target = new Float32Array([0, 0.5, 1]);
    const shown = new Float32Array([0, 0, 0]);
    const first = easeActivity(shown, target, 1 / 60);
    expect(shown[0]).toBe(0);
    expect(shown[1]).toBeGreaterThan(0);
    expect(shown[1]).toBeLessThan(0.5);
    expect(shown[2]).toBeGreaterThan(shown[1]!);
    expect(first).toBeGreaterThan(0);
    let gap = first;
    for (let i = 0; i < 120; i++) gap = easeActivity(shown, target, 1 / 60);
    expect(gap).toBeLessThan(1e-3);
    expect(shown[2]).toBeCloseTo(1, 3);
  });

  it('never overshoots and reaches ~63% after one time constant', () => {
    const v = easeToward(0, 1, ACTIVITY_TAU_S, ACTIVITY_TAU_S);
    expect(v).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(easeToward(0, 1, 10, ACTIVITY_TAU_S)).toBeLessThanOrEqual(1);
    expect(easeToward(1, 0, 10, ACTIVITY_TAU_S)).toBeGreaterThanOrEqual(0);
    expect(easeToward(0.3, 0.7, 0, 1)).toBe(0.7);
  });

  it('emphasises POMPUJ at 500% and mill walk at 300%', () => {
    expect(pulseTargetGain('PUMP')).toBe(PULSE_GAIN_PUMP);
    expect(pulseTargetGain('SEARCH', true)).toBe(PULSE_GAIN_RUN);
    expect(pulseTargetGain('PUMP', true)).toBe(PULSE_GAIN_PUMP);
    for (const s of ['SEARCH', 'ORIENT', 'APPROACH', 'TASTE', 'EXTEND', 'RETRACT', 'REST'] as const) {
      expect(pulseTargetGain(s)).toBe(PULSE_GAIN_REST);
    }
    expect(pulseTargetGain(null)).toBe(PULSE_GAIN_REST);
    expect(PULSE_GAIN_PUMP).toBe(PULSE_GAIN_REST * 5);
    expect(PULSE_GAIN_RUN).toBe(PULSE_GAIN_REST * 3);
    let g = PULSE_GAIN_REST;
    for (let t = 0; t < 0.2; t += 1 / 60) g = easeToward(g, PULSE_GAIN_PUMP, 1 / 60, PULSE_GAIN_TAU_S);
    expect(g).toBeGreaterThan(PULSE_GAIN_REST + (PULSE_GAIN_PUMP - PULSE_GAIN_REST) * 0.55);
    expect(g).toBeLessThan(PULSE_GAIN_PUMP);
  });
});
