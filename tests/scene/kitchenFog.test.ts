import { describe, expect, it } from 'vitest';
import {
  GRID_FLOOR_FOG,
  STUDIO_FOG_AT_BOARD,
  STUDIO_FOG_CAP,
  fogExp2DensityForFactor,
  fogExp2Factor,
  studioFogDensity,
} from '../../src/scene/kitchenFog.ts';
import { KITCHEN_ENV_INTENSITY, KITCHEN_ENV_URL } from '../../src/scene/kitchenEnvironment.ts';

describe('studio FogExp2 cap', () => {
  it('keeps fog at the board at 12% and never above 25%', () => {
    expect(GRID_FLOOR_FOG).toBe(0x07080c);
    for (const dist of [200, 400, 662, 1200, 2000]) {
      const density = studioFogDensity(dist);
      const factor = fogExp2Factor(dist, density);
      expect(factor).toBeCloseTo(STUDIO_FOG_AT_BOARD, 5);
      expect(factor).toBeLessThanOrEqual(STUDIO_FOG_CAP);
    }
    const tooMuch = fogExp2DensityForFactor(500, 0.4);
    expect(fogExp2Factor(500, tooMuch)).toBeGreaterThan(STUDIO_FOG_CAP);
    expect(studioFogDensity(500)).toBeLessThan(tooMuch);
  });
});

describe('kitchen environment', () => {
  it('ships the blurred equirect at half intensity', () => {
    expect(KITCHEN_ENV_URL).toBe('textures/kitchen/env_512.jpg');
    expect(KITCHEN_ENV_INTENSITY).toBe(0.5);
  });
});
