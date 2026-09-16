import { describe, expect, it } from 'vitest';
import { Xoshiro128ss } from '../../src/brain/rng.ts';
import {
  GAG_CAPTIONS_PL,
  GAG_DURATION_CAP,
  GAG_IDS,
  GagPlayer,
  gagEligible,
  pickGag,
  type GagContext,
  type GagId,
} from '../../src/body/gags.ts';
import { canNap, napOverlay } from '../../src/body/grooming.ts';
import { LOOP_STATES, SceneLoop } from '../../src/body/sceneLoop.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';

const dt = 1 / 30;

function ctx(over: Partial<GagContext> = {}): GagContext {
  const layout = kitchenLayout();
  return {
    satiety: 0.7,
    cropVolume: 0.4,
    position: { x: layout.fly.x, y: 2, z: layout.fly.z },
    heading: 0.35,
    pouch: { x: layout.pouch.x, y: layout.pouch.y, z: layout.pouch.z, yaw: layout.pouch.yaw },
    food: { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z },
    standingY: 2,
    ...over,
  };
}

function runGag(id: GagId, over: Partial<GagContext> = {}): { done: boolean; frames: number } {
  const player = new GagPlayer();
  const c = ctx(over);
  player.start(id, c);
  const cap = GAG_DURATION_CAP[id] + 1;
  const steps = Math.ceil(cap / dt);
  for (let i = 0; i < steps; i++) {
    const frame = player.update(dt, c);
    if (frame.done) return { done: true, frames: i + 1 };
  }
  return { done: false, frames: steps };
}

describe('gag picker', () => {
  it('is deterministic on seed 1 and respects entry conditions', () => {
    const a = pickGag(new Xoshiro128ss(1), { satiety: 0.7, cropVolume: 0.4 });
    const b = pickGag(new Xoshiro128ss(1), { satiety: 0.7, cropVolume: 0.4 });
    expect(a).toBe(b);
    expect(gagEligible('courtshipSong', { satiety: 0.4, cropVolume: 0 })).toBe(false);
    expect(gagEligible('tooFull', { satiety: 1, cropVolume: 0.5 })).toBe(false);
    expect(gagEligible('tooFull', { satiety: 1, cropVolume: 0.9 })).toBe(true);
  });
});

describe('gags exit cleanly', () => {
  for (const id of GAG_IDS) {
    it(`${id} exits before its cap`, () => {
      const over = id === 'tooFull' ? { cropVolume: 0.9, satiety: 0.9 } : id === 'courtshipSong' ? { satiety: 0.7 } : {};
      const result = runGag(id, over);
      expect(result.done, GAG_CAPTIONS_PL[id]).toBe(true);
    });
  }
});

describe('NAP threshold (Murphy 2016)', () => {
  it('is only allowed above satiety 0.8', () => {
    expect(canNap(0.8)).toBe(false);
    expect(canNap(0.81)).toBe(true);
    expect(napOverlay(0, 0.5).done).toBe(false);
  });
});

describe('scene loop seed 1', () => {
  it('walks the macro states in order and can complete', () => {
    const loop = new SceneLoop(1);
    expect(LOOP_STATES[0]).toBe('ORBIT');
    const seen: string[] = [loop.state];
    let guard = 0;
    while (guard++ < 80) {
      const flags = {
        flightDone: true,
        walkDone: true,
        eatBoutDone: true,
        groomDone: true,
        gagDone: true,
        napDone: true,
        wakeDone: true,
        satiety: 0.9,
        cropVolume: 0.3,
      };
      const out = loop.step(0.2, flags);
      if (out.advanced && !seen.includes(out.state)) seen.push(out.state);
      if (seen.includes('EXIT_FRAME') && out.state === 'ORBIT' && seen.length > 8) break;
    }
    expect(seen).toContain('LAND_TOP');
    expect(seen).toContain('EAT_TOP');
    expect(seen).toContain('GROOM_SHORT');
    expect(seen).toContain('EAT_SIDE');
    expect(seen).toContain('GROOM_FULL');
    expect(seen).toContain('NAP');
    expect(seen).toContain('EXIT_FRAME');
  });

  it('emits authored loop captions', () => {
    const loop = new SceneLoop(1);
    const flags = {
      flightDone: false, walkDone: false, eatBoutDone: false, groomDone: false,
      gagDone: false, napDone: false, wakeDone: false, satiety: 0.9, cropVolume: 0.3,
    };
    const out = loop.step(0, flags);
    expect(out.caption).toBe('Krąży');
  });

  it('skips NAP when satiety is below threshold', () => {
    const loop = new SceneLoop(1);
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const out = loop.step(0.5, {
        flightDone: true, walkDone: true, eatBoutDone: true, groomDone: true,
        gagDone: true, napDone: true, wakeDone: true, satiety: 0.4, cropVolume: 0.2,
      });
      if (!seen.includes(out.state)) seen.push(out.state);
    }
    expect(seen).not.toContain('NAP');
    expect(seen).toContain('TAKEOFF_EXIT');
  });
});
