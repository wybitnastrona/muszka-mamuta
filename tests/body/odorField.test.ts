import { describe, expect, it } from 'vitest';
import { ODOR_DETECT, odorConcentration, odorGradientYaw } from '../../src/body/odorField.ts';

describe('vanillin odor field', () => {
  it('peaks on the food and falls off with distance', () => {
    const food = { x: 0.1, z: 0.2 };
    const onFood = odorConcentration(food, food, 0.85);
    const far = odorConcentration({ x: 1, z: 1 }, food, 0.85);
    expect(onFood).toBeCloseTo(0.85);
    expect(far).toBeLessThan(ODOR_DETECT);
  });

  it('points the gradient at the food', () => {
    const food = { x: 0.4, z: 0.1 };
    const yaw = odorGradientYaw({ x: 0, z: 0 }, food);
    expect(yaw).toBeCloseTo(Math.atan2(0.4, 0.1));
  });
});
