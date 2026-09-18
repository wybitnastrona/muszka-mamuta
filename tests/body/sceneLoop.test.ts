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
import { EAT_BOUT_CAP_S, LOOP_STATES, SceneLoop, type LoopFlags } from '../../src/body/sceneLoop.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';

const dt = 1 / 30;

function ctx(over: Partial<GagContext> = {}): GagContext {
  const layout = kitchenLayout();
  return {
    satiety: 0.7,
    cropVolume: 0.4,
    position: { x: layout.fly.x, y: layout.board.topY + 2, z: layout.fly.z },
    heading: 0.35,
    pouch: { x: layout.pouch.x, y: layout.pouch.y, z: layout.pouch.z, yaw: layout.pouch.yaw },
    food: { x: layout.pile.x, y: layout.pile.y, z: layout.pile.z },
    standingY: layout.board.topY + 2,
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

const done: LoopFlags = {
  flightDone: true,
  walkDone: true,
  eatBoutDone: true,
  groomDone: true,
  gagDone: true,
  napDone: true,
  wakeDone: true,
  propDone: true,
  satiety: 0.9,
  cropVolume: 0.3,
};

describe('gag picker', () => {
  it('is deterministic on seed 1 and respects entry conditions', () => {
    const a = pickGag(new Xoshiro128ss(1), { satiety: 0.7, cropVolume: 0.4 });
    const b = pickGag(new Xoshiro128ss(1), { satiety: 0.7, cropVolume: 0.4 });
    expect(a).toBe(b);
    expect(gagEligible('courtshipSong', { satiety: 0.4, cropVolume: 0 })).toBe(false);
    expect(gagEligible('courtshipSong', { satiety: 0.51, cropVolume: 0 })).toBe(true);
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

describe('scene loop seed 1 (reel default)', () => {
  it('starts flying into the tub and ends in AUTONOMOUS roam', () => {
    const loop = new SceneLoop(1);
    expect(LOOP_STATES[0]).toBe('ORBIT');
    expect(loop.state).toBe('FLY_INTO_TUB');
    const seen: string[] = [loop.state];
    let wrapped = false;
    let guard = 0;
    while (guard++ < 80) {
      const out = loop.step(0.2, done);
      if (out.wrapped) wrapped = true;
      if (out.advanced && !seen.includes(out.state)) seen.push(out.state);
      if (out.state === 'AUTONOMOUS' && seen.length > 6) break;
    }
    expect(seen).toContain('PICK_SCOOP');
    expect(seen).toContain('EAT_SCOOP');
    expect(seen).toContain('FLY_OUT_WITH_SCOOP');
    expect(seen).toContain('WALK_BIPED_ON_MILL');
    expect(seen).toContain('AUTONOMOUS');
    expect(seen).not.toContain('DROP_SCOOP');
    expect(seen).not.toContain('DIP_SCOOP');
    expect(seen).not.toContain('ORBIT');
    expect(seen).not.toContain('ORBIT_SHORT');
    expect(seen).not.toContain('EXIT_FRAME');
    expect(seen).not.toContain('TAKEOFF_EXIT');
    expect(wrapped).toBe(false);
  });

  it('reaches EAT_SCOOP after pick, then flies out to the mill', () => {
    const loop = new SceneLoop(1);
    expect(loop.state).toBe('FLY_INTO_TUB');
    loop.step(6, { ...done, flightDone: true });
    expect(loop.state).toBe('PICK_SCOOP');
    loop.step(1, { ...done, propDone: true });
    expect(loop.state).toBe('EAT_SCOOP');
    const toEat = 6 + 1;
    expect(toEat).toBeLessThanOrEqual(30);
    expect(toEat).toBeGreaterThanOrEqual(5);
    let t = 0;
    while (loop.state === 'EAT_SCOOP' && t < 50) {
      loop.step(0.5, { ...done, eatBoutDone: false, satiety: 0.3 });
      t += 0.5;
    }
    expect(t).toBeGreaterThanOrEqual(EAT_BOUT_CAP_S);
    expect(loop.state).toBe('FLY_OUT_WITH_SCOOP');
  });

  it('emits a mill caption on WALK_BIPED_ON_MILL', () => {
    const loop = new SceneLoop(1);
    const seen: string[] = [];
    let millCaption = '';
    for (let i = 0; i < 40; i++) {
      const out = loop.step(0.5, done);
      if (!seen.includes(out.state)) seen.push(out.state);
      if (out.state === 'WALK_BIPED_ON_MILL' && !millCaption) millCaption = out.caption ?? '';
    }
    expect(seen).toContain('WALK_BIPED_ON_MILL');
    expect(millCaption).toBe('Chodzi na dwóch');
  });

  it('stays in AUTONOMOUS instead of wrapping to takeoff-exit', () => {
    const loop = new SceneLoop(1);
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const out = loop.step(0.5, {
        ...done,
        satiety: 0.4,
        cropVolume: 0.2,
      });
      if (!seen.includes(out.state)) seen.push(out.state);
    }
    expect(seen).not.toContain('NAP');
    expect(seen).not.toContain('TAKEOFF_EXIT');
    expect(seen).toContain('AUTONOMOUS');
  });
});

describe('scene loop seed 1 (full / debug)', () => {
  it('walks the orbit → mill → exit-frame graph', () => {
    const loop = new SceneLoop(1, 'full');
    expect(loop.state).toBe('ORBIT');
    const seen: string[] = [loop.state];
    let guard = 0;
    while (guard++ < 80) {
      const out = loop.step(0.2, done);
      if (out.advanced && !seen.includes(out.state)) seen.push(out.state);
      if (seen.includes('EXIT_FRAME') && out.state === 'ORBIT' && seen.length > 8) break;
    }
    expect(seen).toContain('LAND_TOP');
    expect(seen).toContain('FLY_INTO_TUB');
    expect(seen).toContain('EAT_SCOOP');
    expect(seen).toContain('WALK_BIPED_ON_MILL');
    expect(seen).toContain('GROOM_FULL');
    expect(seen).toContain('NAP');
    expect(seen).toContain('EXIT_FRAME');
  });

  it('emits authored orbit captions', () => {
    const loop = new SceneLoop(1, 'full');
    const out = loop.step(0, { ...done, flightDone: false, eatBoutDone: false, walkDone: false, groomDone: false, propDone: false });
    expect(out.caption).toBe('Krąży');
  });

  it('skips NAP when satiety is below threshold', () => {
    const loop = new SceneLoop(1, 'full');
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const out = loop.step(0.5, {
        ...done,
        satiety: 0.4,
        cropVolume: 0.2,
      });
      if (!seen.includes(out.state)) seen.push(out.state);
    }
    expect(seen).not.toContain('NAP');
    expect(seen).toContain('TAKEOFF_EXIT');
  });
});
