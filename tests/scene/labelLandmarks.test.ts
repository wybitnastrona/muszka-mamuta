import { describe, expect, it } from 'vitest';
import {
  PACK_BACK_NUTRITION_ROWS,
  PACK_FRONT_COW_UV,
  opaqueUvToPouchLocal,
  pouchLocalToWorld,
} from '../../src/scene/labelLandmarks.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';

describe('pouch label landmarks', () => {
  it('maps the cow UV onto the pouch and the protein row is last', () => {
    const local = opaqueUvToPouchLocal(PACK_FRONT_COW_UV);
    expect(Number.isFinite(local.x)).toBe(true);
    expect(Math.abs(local.x)).toBeLessThan(70);
    expect(PACK_BACK_NUTRITION_ROWS.at(-1)?.id).toBe('protein');
    const layout = kitchenLayout();
    const world = pouchLocalToWorld(local, layout.pouch);
    expect(Math.hypot(world.x - layout.pouch.x, world.z - layout.pouch.z)).toBeGreaterThan(1);
  });
});
