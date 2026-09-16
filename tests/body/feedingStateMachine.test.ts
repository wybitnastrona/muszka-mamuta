import { describe, expect, it } from 'vitest';
import {
  FeedingStateMachine,
  HEADING_ALIGN_DEG,
  MN9_HOLD_MS,
  SATIETY_RETRACT,
} from '../../src/body/feedingStateMachine.ts';
import { headingError } from '../../src/body/math.ts';
import type { FeedingState } from '../../src/body/types.ts';
import { odorGradientYaw } from '../../src/body/odorField.ts';

const dt = 1 / 60;

function drive(
  sm: FeedingStateMachine,
  seconds: number,
  input: {
    mn9Rate?: number;
    bitter?: number;
    satiety?: number;
    odorYaw?: number;
    odorStrength?: number;
    distanceToFood?: number;
  } = {},
): FeedingState[] {
  const seen: FeedingState[] = [sm.state];
  const steps = Math.ceil(seconds / dt);
  for (let i = 0; i < steps; i++) {
    sm.step({
      dt,
      mn9Rate: input.mn9Rate ?? 0,
      bitter: input.bitter ?? 0,
      satiety: input.satiety ?? 0.2,
      odorYaw: input.odorYaw ?? 0,
      odorStrength: input.odorStrength ?? 1,
      distanceToFood: input.distanceToFood ?? 0.04,
    });
    if (seen.at(-1) !== sm.state) seen.push(sm.state);
  }
  return seen;
}

describe('feeding state machine', () => {
  it('follows SEARCH → ORIENT → APPROACH → TASTE → EXTEND → PUMP → RETRACT → REST on an MN9 burst', () => {
    const sm = new FeedingStateMachine({ heading: 0.6 });
    const seen: FeedingState[] = [sm.state];
    let dist = 0.12;
    for (let i = 0; i < 800; i++) {
      const t = i * dt;
      if (sm.state === 'APPROACH') dist = Math.max(0.03, dist - 0.06 * dt);
      const mn9 = sm.state === 'TASTE' || sm.state === 'EXTEND' || sm.state === 'PUMP' ? 18 : 0;
      sm.step({
        dt,
        mn9Rate: t > 0.05 ? mn9 : 0,
        bitter: 0,
        satiety: 0.2,
        odorYaw: 0,
        odorStrength: 1,
        distanceToFood: dist,
      });
      if (seen.at(-1) !== sm.state) seen.push(sm.state);
      if (sm.state === 'REST' && seen.includes('PUMP')) break;
    }
    expect(seen).toEqual([
      'SEARCH',
      'ORIENT',
      'APPROACH',
      'TASTE',
      'EXTEND',
      'PUMP',
      'RETRACT',
      'REST',
    ]);
  });

  it('holds EXTEND until MN9 stays above threshold for 80 ms', () => {
    const sm = new FeedingStateMachine({ heading: 0 });
    drive(sm, 0.4, { mn9Rate: 0, distanceToFood: 0.03, odorStrength: 1, odorYaw: 0 });
    expect(sm.state).toBe('TASTE');
    drive(sm, (MN9_HOLD_MS - 20) / 1000, { mn9Rate: 12, distanceToFood: 0.03 });
    expect(sm.state).toBe('TASTE');
    drive(sm, 0.08, { mn9Rate: 12, distanceToFood: 0.03 });
    expect(sm.state).toBe('EXTEND');
  });

  it('emits a bite once per completed pump cycle', () => {
    const sm = new FeedingStateMachine({ heading: 0 });
    drive(sm, 0.5, { mn9Rate: 12, distanceToFood: 0.03, odorStrength: 1, odorYaw: 0 });
    expect(['EXTEND', 'PUMP', 'RETRACT']).toContain(sm.state);
    const bites: number[] = [];
    for (let i = 0; i < 400; i++) {
      const out = sm.step({
        dt,
        mn9Rate: 40,
        bitter: 0,
        satiety: 0.2,
        odorYaw: 0,
        odorStrength: 1,
        distanceToFood: 0.03,
      });
      for (const e of out.events) if (e.type === 'bite') bites.push(e.cycle);
      if (sm.state === 'RETRACT' || sm.state === 'REST') break;
    }
    expect(bites.length).toBeGreaterThanOrEqual(2);
    expect(bites.length).toBeLessThanOrEqual(5);
  });

  it('retracts early when satiety exceeds 0.85', () => {
    const sm = new FeedingStateMachine({ heading: 0 });
    drive(sm, 0.7, { mn9Rate: 20, distanceToFood: 0.03, odorStrength: 1, odorYaw: 0 });
    if (sm.state !== 'PUMP') {
      drive(sm, 0.5, { mn9Rate: 20, distanceToFood: 0.03 });
    }
    expect(sm.state).toBe('PUMP');
    drive(sm, 0.05, { mn9Rate: 20, satiety: SATIETY_RETRACT + 0.02, distanceToFood: 0.03 });
    expect(sm.state).toBe('RETRACT');
  });
});

describe('ORIENT', () => {
  it('converges toward the odor source from any starting heading', () => {
    const food = { x: 0, z: 0.2 };
    const fly = { x: 0, z: 0 };
    const target = odorGradientYaw(fly, food);
    const starts = [0.2, 1.1, Math.PI, -2.2, -3.0, 2.7];
    for (const start of starts) {
      const sm = new FeedingStateMachine({ heading: start });
      let leftOrientAt = Infinity;
      for (let i = 0; i < 240; i++) {
        const prev = sm.state;
        sm.step({
          dt,
          mn9Rate: 0,
          bitter: 0,
          satiety: 0.2,
          odorYaw: target,
          odorStrength: 1,
          distanceToFood: 0.2,
        });
        if (prev === 'ORIENT' && sm.state !== 'ORIENT') {
          leftOrientAt = Math.abs(headingError(sm.heading, target)) * (180 / Math.PI);
          break;
        }
      }
      expect(leftOrientAt).toBeLessThan(HEADING_ALIGN_DEG + 1e-3);
    }
  });
});
