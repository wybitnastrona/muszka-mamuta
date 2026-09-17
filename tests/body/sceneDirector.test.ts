import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SceneDirector } from '../../src/body/sceneDirector.ts';
import { overviewFrame, frameForPreset, CAMERA_PRESETS } from '../../src/body/cameras.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';
import { CURD_MM, POUCH_MM, flyVisualLengthMm, mm, tableTopY } from '../../src/scene/scale.ts';
import { TWAROG_MAMUTA_WANILIOWY } from '../../src/food/foodProfile.ts';
import { fractureCurdBlock } from '../../src/food/proceduralTwarog.ts';
import { TwarogSystem } from '../../src/food/twarogSystem.ts';
import { runGroundTrace, type GroundTraceFrame, type GroundTraceOpts } from './groundTrace.ts';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/scene-director-trace.json');

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function makeDirector() {
  const layout = kitchenLayout();
  const food = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
  return new SceneDirector({
    food,
    foodOrigin: { x: layout.curd.x, y: tableTopY() + mm(CURD_MM.height) / 2, z: layout.curd.z },
    pouch: {
      cx: layout.pouch.x,
      cz: layout.pouch.z,
      hx: mm(POUCH_MM.length) / 2,
      hz: mm(POUCH_MM.width) / 2,
      yaw: layout.pouch.yaw,
    },
    position: { x: layout.fly.x, y: layout.board.topY + 2, z: layout.fly.z },
    heading: 0.35,
  });
}

function traceDirector(opts: GroundTraceOpts): GroundTraceFrame[] {
  const dt = opts.dt ?? 1 / 60;
  const director = makeDirector();
  const frames: GroundTraceFrame[] = [];
  for (let i = 0; i < opts.steps; i++) {
    const out = director.update({
      dt,
      mn9Rate: opts.mn9Rate ?? 0,
      satiety: opts.satiety ?? 0.2,
      bitter: opts.bitter ?? 0,
      odor: opts.odor ?? TWAROG_MAMUTA_WANILIOWY.odor,
      cameraDist: 400,
    });
    frames.push({
      i,
      x: round(out.flyPose.position.x),
      y: round(out.flyPose.position.y),
      z: round(out.flyPose.position.z),
      heading: round(out.flyPose.heading),
      state: out.state,
      clip: out.flyPose.clipName,
      clipTime: round(out.flyPose.clipTime),
      walk: round(out.walk),
      pumpAmplitude: round(out.flyPose.pumpAmplitude),
      hudState: out.hudState,
    });
  }
  return frames;
}

const CASES: { name: string; opts: GroundTraceOpts }[] = [
  { name: 'search', opts: { steps: 240, mn9Rate: 0, satiety: 0.2 } },
  { name: 'drive', opts: { steps: 240, mn9Rate: 20, satiety: 0.2 } },
];

describe('SceneDirector', () => {
  it('matches the ground-trace fixture', () => {
    const traces: Record<string, GroundTraceFrame[]> = {};
    for (const { name, opts } of CASES) traces[name] = traceDirector(opts);
    if (process.env.RECORD_TRACE === '1') {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify({ dt: 1 / 60, traces })}\n`);
    }
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { traces: Record<string, GroundTraceFrame[]> };
    for (const { name, opts } of CASES) {
      expect(runGroundTrace(opts), `legacy ${name}`).toHaveLength(opts.steps);
      expect(traces[name], `director ${name}`).toEqual(fixture.traces[name]);
    }
  });

  it('stays in ground mode and reset returns to spawn', () => {
    const director = makeDirector();
    const spawn = director.position.clone();
    for (let i = 0; i < 30; i++) {
      const out = director.update({
        dt: 1 / 60, mn9Rate: 0, satiety: 0.2, bitter: 0, odor: 1, cameraDist: 400,
      });
      expect(out.mode).toBe('ground');
    }
    director.reset(7);
    expect(director.mode).toBe('ground');
    expect(director.position.x).toBeCloseTo(spawn.x);
    expect(director.position.z).toBeCloseTo(spawn.z);
    expect(director.fsm.state).toBe('SEARCH');
  });
});

describe('Przegląd camera', () => {
  it('is a 3/4 front-left view of the fly, pulled back from the mesh', () => {
    expect(CAMERA_PRESETS).toContain('Przegląd');
    const layout = kitchenLayout();
    const frame = frameForPreset('Przegląd', flyVisualLengthMm() / 2);
    const overview = overviewFrame();
    expect(frame).toEqual(overview);
    expect(frame.position[0]).toBeGreaterThan(layout.fly.x);
    expect(frame.position[1]).toBeGreaterThan(8);
    expect(frame.position[2]).toBeGreaterThan(layout.fly.z);
    const dist = Math.hypot(
      frame.position[0] - layout.fly.x,
      frame.position[1] - 4,
      frame.position[2] - layout.fly.z,
    );
    expect(dist).toBeGreaterThan(flyVisualLengthMm());
  });
});
