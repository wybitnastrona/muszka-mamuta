import { describe, expect, it } from 'vitest';
import {
  CABLE_CEILING_MM,
  CABLE_POINTS,
  CABLE_SLACK,
  HEADSTAGE_MM,
  cableSegmentLength,
  createCableChain,
  maxSegment,
  stepCable,
} from '../../src/body/headstage.ts';
import { FLIGHT_CEILING_MM } from '../../src/body/collision.ts';
import { flyVisualLengthMm } from '../../src/scene/scale.ts';

const dt = 1 / 60;

describe('headstage tether (authored prop, pure rope solver)', () => {
  it('pins both ends and never stretches a segment beyond its rest length', () => {
    // Fly wanders (≈1.5 mm per frame, ~90 mm/s cruise) while the rope settles.
    const at = (i: number) => ({
      x: 12 + Math.sin(i * 0.05) * 30,
      y: 58 + Math.sin(i * 0.1) * 6,
      z: -20 + Math.cos(i * 0.04) * 25,
    });
    const head = at(0);
    const chain = createCableChain(head);
    for (let i = 0; i < 240; i++) {
      Object.assign(head, at(i));
      stepCable(chain, head, dt);
      expect(chain.points[0]).toEqual(head);
      const last = chain.points[CABLE_POINTS - 1]!;
      expect(last.y).toBe(CABLE_CEILING_MM);
      expect(last.x).toBe(chain.anchor.x);
      const seg = cableSegmentLength(head, chain.anchor);
      // Position-based relaxation with a moving pin: allow a few percent of residual stretch.
      expect(maxSegment(chain)).toBeLessThanOrEqual(seg * 1.03);
      // Tether hangs from above: no free point below the socket.
      for (let k = 1; k < CABLE_POINTS - 1; k++) expect(chain.points[k]!.y).toBeGreaterThanOrEqual(head.y - 1e-9);
    }
  });

  it('converges to rest when the head is still (no drift), and the anchor catches up in XZ', () => {
    const head = { x: 40, y: 60, z: 10 };
    const chain = createCableChain({ x: 0, y: 60, z: 0 });
    for (let i = 0; i < 600; i++) stepCable(chain, head, dt);
    const before = chain.points.map((p) => ({ ...p }));
    stepCable(chain, head, dt);
    let moved = 0;
    chain.points.forEach((p, i) => {
      moved = Math.max(moved, Math.hypot(p.x - before[i]!.x, p.y - before[i]!.y, p.z - before[i]!.z));
    });
    expect(moved).toBeLessThan(0.05);
    expect(chain.anchor.x).toBeCloseTo(head.x, 1);
    expect(chain.anchor.z).toBeCloseTo(head.z, 1);
    // With CABLE_SLACK > 1 the rope is not a straight line: there is visible sag/sway.
    expect(CABLE_SLACK).toBeGreaterThan(1);
  });

  it('exits above every camera frame and is thin against the fly', () => {
    expect(CABLE_CEILING_MM).toBeGreaterThan(FLIGHT_CEILING_MM);
    expect(HEADSTAGE_MM.cableRadius * 2).toBeLessThan(flyVisualLengthMm() * 0.08);
    expect(HEADSTAGE_MM.capWidth).toBeLessThan(flyVisualLengthMm() * 0.25);
  });
});
