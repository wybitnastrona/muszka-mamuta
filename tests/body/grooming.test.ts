import { describe, expect, it } from 'vitest';
import { groomFullOverlay } from '../../src/body/grooming.ts';
import { raiseForDeltaDeg } from '../../src/body/wings.ts';

describe('GROOM_full wing phase', () => {
  it('sweeps the hind legs and opens the blades ~30°', () => {
    const mid = groomFullOverlay(7.1);
    expect(mid.euler.hindleg_L).toBeDefined();
    expect(mid.euler.hindleg_R).toBeDefined();
    expect(mid.wingRaise).toBeGreaterThan(raiseForDeltaDeg(30) * 0.4);
    const rest = groomFullOverlay(0);
    expect(rest.euler.hindleg_L).toBeUndefined();
    expect(rest.wingRaise).toBe(0);
  });
});
