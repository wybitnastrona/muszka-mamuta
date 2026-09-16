#!/usr/bin/env node
/**
 * 10-minute simulated soak of the authored scene loop (seed 1).
 * Checks Node heap after warmup vs the last minute. Not a browser GPU soak.
 */
import { SceneDirector } from '../src/body/sceneDirector.ts';
import { kitchenLayout } from '../src/scene/layout.ts';
import { POUCH_MM, mm } from '../src/scene/scale.ts';
import { fractureCurdBlock } from '../src/food/proceduralTwarog.ts';
import { TwarogSystem } from '../src/food/twarogSystem.ts';

const SIM_S = 600;
const DT = 1 / 30;
const STEPS = Math.round(SIM_S / DT);

function heap(): number {
  const g = globalThis as typeof globalThis & { gc?: () => void };
  g.gc?.();
  return process.memoryUsage().heapUsed;
}

function director() {
  const layout = kitchenLayout();
  const food = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
  return new SceneDirector({
    food,
    foodOrigin: { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z },
    pouch: {
      cx: layout.pouch.x,
      cz: layout.pouch.z,
      hx: mm(POUCH_MM.length) / 2,
      hz: mm(POUCH_MM.width) / 2,
      yaw: layout.pouch.yaw,
    },
    position: { x: layout.fly.x, y: 2, z: layout.fly.z },
    heading: 0.35,
    seed: 1,
    scriptedLoop: true,
  });
}

const drive = {
  dt: DT,
  mn9Rate: 20,
  satiety: 0.9,
  bitter: 0,
  odor: 1,
  cameraDist: 400,
  cropVolume: 0.3,
};

const d = director();
const warmSteps = Math.round(60 / DT);
for (let i = 0; i < warmSteps; i++) d.update(drive);
const start = heap();
let wraps = 0;
for (let i = 0; i < STEPS; i++) {
  if (d.update(drive).loopWrapped) wraps += 1;
}
const end = heap();
const growthMiB = (end - start) / (1024 * 1024);
const limitMiB = 24;
console.log(
  `soak ${SIM_S}s sim @ ${1 / DT} Hz, wraps=${wraps}, ` +
    `heap ${(start / 1e6).toFixed(1)} → ${(end / 1e6).toFixed(1)} MB ` +
    `(Δ ${growthMiB.toFixed(2)} MiB)`,
);
if (wraps < 1) {
  console.error('FAIL  scene loop never wrapped in 10 minutes of simulated time');
  process.exit(1);
}
if (growthMiB > limitMiB) {
  console.error(`FAIL  heap grew ${growthMiB.toFixed(2)} MiB (limit ${limitMiB})`);
  process.exit(1);
}
console.log('PASS  soak: loop wrapped and heap growth within limit');
