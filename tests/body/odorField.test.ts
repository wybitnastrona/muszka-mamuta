import { describe, expect, it } from 'vitest';
import { ODOR_DETECT, ODOR_R0, odorConcentration, odorGradientYaw } from '../../src/body/odorField.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe('vanillin odor field', () => {
  it('peaks on the food and follows 1/r, filling the table', () => {
    const food = { x: 0.1, z: 0.2 };
    const onFood = odorConcentration(food, food, 0.85);
    const atR0 = odorConcentration({ x: food.x + ODOR_R0, z: food.z }, food, 0.85);
    expect(onFood).toBeCloseTo(0.85);
    expect(atR0).toBeCloseTo(0.85 / 2, 5);
    const layout = kitchenLayout();
    const corner = {
      x: layout.curd.x + layout.table.width / 2,
      z: layout.curd.z + layout.table.depth / 2,
    };
    const tableEdge = odorConcentration(corner, { x: layout.curd.x, z: layout.curd.z }, 0.85);
    expect(tableEdge).toBeGreaterThan(ODOR_DETECT);
    expect(tableEdge).toBeGreaterThan(0.2);
    expect(tableEdge).toBeLessThan(onFood);
  });

  it('points the gradient at the food from any position on the table', () => {
    const layout = kitchenLayout();
    const food = { x: layout.curd.x, z: layout.curd.z };
    const halfW = layout.table.width / 2;
    const halfD = layout.table.depth / 2;
    const samples = [
      { x: food.x - halfW, z: food.z - halfD },
      { x: food.x + halfW, z: food.z - halfD },
      { x: food.x - halfW, z: food.z + halfD },
      { x: food.x + halfW, z: food.z + halfD },
      { x: food.x + 40, z: food.z - 90 },
      { x: food.x - 25, z: food.z + 60 },
    ];
    for (const pos of samples) {
      const yaw = odorGradientYaw(pos, food);
      expect(yaw).toBeCloseTo(Math.atan2(food.x - pos.x, food.z - pos.z));
      const next = {
        x: pos.x + Math.sin(yaw) * 8,
        z: pos.z + Math.cos(yaw) * 8,
      };
      expect(dist(next, food)).toBeLessThan(dist(pos, food));
    }
  });
});
