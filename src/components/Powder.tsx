import * as THREE from 'three';
import { CREATINE_ALBEDO_HEX, PILE_MM, crumbSizeMm, mm } from '../scene/scale.ts';
import type { ConsumeEvent } from '../food/twarogSystem.ts';
import type { CreatineSystem } from '../food/creatineSystem.ts';
import { Xoshiro128ss } from '../brain/rng.ts';

const GRAIN_POOL = 80;
const DUST_POOL = 48;
const GRAVITY = 420;

export type PowderView = {
  group: THREE.Group;
  update(dt: number, system: CreatineSystem): void;
  spawnCrumbs(event: ConsumeEvent): void;
  resetCrumbs(): void;
  dispose(): void;
};

type Dust = {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  settled: boolean;
};

export function createPowderView(
  origin: { x: number; y: number; z: number },
  crumbMap?: THREE.Texture | null,
): PowderView {
  const group = new THREE.Group();
  group.name = 'creatinePile';
  group.position.set(origin.x, origin.y, origin.z);
  const dummy = new THREE.Object3D();
  const grainMat = new THREE.MeshStandardMaterial({
    color: crumbMap ? 0xffffff : CREATINE_ALBEDO_HEX,
    map: crumbMap ?? null,
    roughness: 0.92,
    metalness: 0,
  });
  const grainSize = crumbSizeMm() * 1.15;
  const grains = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(grainSize * 0.55, 0),
    grainMat,
    GRAIN_POOL,
  );
  grains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grains.castShadow = true;
  grains.receiveShadow = true;
  grains.frustumCulled = false;
  group.add(grains);

  const dustMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(grainSize * 0.45, grainSize * 0.3, grainSize * 0.4),
    grainMat,
    DUST_POOL,
  );
  dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dustMesh.castShadow = true;
  dustMesh.frustumCulled = false;
  group.add(dustMesh);

  const dust: Dust[] = Array.from({ length: DUST_POOL }, () => ({
    active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, settled: false,
  }));
  let dustCursor = 0;

  const hide = (mesh: THREE.InstancedMesh, i: number) => {
    dummy.position.set(0, -40, 0);
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };

  const seedHalo = () => {
    const rng = new Xoshiro128ss(19);
    for (let i = 0; i < 10; i++) {
      const slot = dust[i]!;
      const ang = rng.nextFloat() * Math.PI * 2;
      const rad = mm(PILE_MM.radius) * 0.95 + rng.nextFloat() * 6;
      slot.active = true;
      slot.settled = true;
      slot.x = Math.cos(ang) * rad;
      slot.y = -origin.y + 0.4;
      slot.z = Math.sin(ang) * rad;
    }
    dustCursor = 10;
  };
  seedHalo();

  return {
    group,
    update(dt, system) {
      dummy.rotation.set(0, 0, 0);
      for (let i = 0; i < GRAIN_POOL; i++) {
        const c = system.chunks[i];
        if (!c || c.eaten) {
          hide(grains, i);
          continue;
        }
        const s = Math.max(0.12, system.scaleOf(i));
        dummy.position.set(c.centroid.x, c.topY - 0.6, c.centroid.z);
        dummy.scale.setScalar(s * (0.7 + 0.45 * (c.radiusXz / 2.4)));
        dummy.rotation.y = i * 0.47;
        dummy.updateMatrix();
        grains.setMatrixAt(i, dummy.matrix);
      }
      grains.instanceMatrix.needsUpdate = true;
      grains.count = Math.min(GRAIN_POOL, system.chunkCount);

      const floor = -origin.y + 0.35;
      for (let i = 0; i < DUST_POOL; i++) {
        const p = dust[i]!;
        if (!p.active) {
          hide(dustMesh, i);
          continue;
        }
        if (!p.settled) {
          p.vy -= GRAVITY * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          if (p.y <= floor) {
            p.y = floor;
            p.settled = true;
            p.vx = 0;
            p.vy = 0;
            p.vz = 0;
          }
        }
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.settled ? 0.7 : 1);
        dummy.updateMatrix();
        dustMesh.setMatrixAt(i, dummy.matrix);
      }
      dustMesh.instanceMatrix.needsUpdate = true;
    },
    spawnCrumbs(event) {
      for (let n = 0; n < event.crumbCount; n++) {
        const slot = dust[dustCursor % DUST_POOL]!;
        dustCursor++;
        slot.active = true;
        slot.settled = false;
        slot.x = event.centroid.x + (n - 2) * 0.6;
        slot.y = event.centroid.y + 2;
        slot.z = event.centroid.z + (n % 3) * 0.4;
        slot.vx = (n - 2) * 8;
        slot.vy = 18 + n * 2;
        slot.vz = ((n % 2) * 2 - 1) * 6;
      }
    },
    resetCrumbs() {
      for (const p of dust) p.active = false;
      seedHalo();
    },
    dispose() {
      grains.geometry.dispose();
      dustMesh.geometry.dispose();
      grainMat.dispose();
    },
  };
}
