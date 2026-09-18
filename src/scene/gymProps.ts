/**
 * Authored gym corner beside the mill. Fly-scale primitives — not real
 * gym millimetres, no external meshes.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BENCH_MM, DUMBBELL_MM, MAT_MM, mm } from './scale.ts';
import { kitchenLayout } from './layout.ts';

export type GymPropsHandle = {
  group: THREE.Group;
  dispose(): void;
};

const MAT_HEX = 0x1d2a3a;
const PLATE_HEX = 0x3a3d42;
const BAR_HEX = 0x9aa3ad;
const LEATHER_HEX = 0x2a1c16;
const FRAME_HEX = 0x1a1d22;

export function createDumbbell(lengthMm: number, plateRadiusMm: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gymDumbbell';
  const plateT = mm(DUMBBELL_MM.plateThick);
  const barR = mm(DUMBBELL_MM.barRadius);
  const plateMat = new THREE.MeshStandardMaterial({
    color: PLATE_HEX,
    metalness: 0.5,
    roughness: 0.35,
  });
  const barMat = new THREE.MeshStandardMaterial({
    color: BAR_HEX,
    metalness: 0.72,
    roughness: 0.28,
  });
  const barLen = Math.max(2, lengthMm - 2 * plateT);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(barR, barR, barLen, 12), barMat);
  bar.rotation.z = Math.PI / 2;
  bar.castShadow = true;
  bar.receiveShadow = true;
  group.add(bar);
  const plateGeo = new THREE.CylinderGeometry(plateRadiusMm, plateRadiusMm, plateT, 20);
  const pL = new THREE.Mesh(plateGeo, plateMat);
  const pR = new THREE.Mesh(plateGeo, plateMat);
  pL.rotation.z = Math.PI / 2;
  pR.rotation.z = Math.PI / 2;
  pL.position.set(-lengthMm / 2 + plateT / 2, 0, 0);
  pR.position.set(lengthMm / 2 - plateT / 2, 0, 0);
  pL.castShadow = true;
  pR.castShadow = true;
  pL.receiveShadow = true;
  pR.receiveShadow = true;
  group.add(pL, pR);
  return group;
}

function addAFrameLegs(
  parent: THREE.Group,
  x: number,
  seatY: number,
  spreadZ: number,
  mat: THREE.Material,
): void {
  const h = Math.max(4, seatY - 0.4);
  const lean = 0.34;
  const geo = new THREE.BoxGeometry(3.4, h, 3.2);
  for (const sign of [-1, 1] as const) {
    const leg = new THREE.Mesh(geo, mat);
    leg.position.set(x, h / 2, 0);
    leg.rotation.x = sign * lean;
    leg.position.z = sign * spreadZ * 0.18;
    leg.castShadow = true;
    leg.receiveShadow = true;
    parent.add(leg);
  }
}

export function gymDumbbellStackFootprintMm(): { length: number; width: number } {
  const { dumbbells } = kitchenLayout();
  const r = mm(DUMBBELL_MM.plateRadius);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const d of dumbbells) {
    const c = Math.abs(Math.cos(d.yaw));
    const s = Math.abs(Math.sin(d.yaw));
    const hx = d.hx * c + r * s;
    const hz = d.hx * s + r * c;
    minX = Math.min(minX, d.x - hx);
    maxX = Math.max(maxX, d.x + hx);
    minZ = Math.min(minZ, d.z - hz);
    maxZ = Math.max(maxZ, d.z + hz);
  }
  return { length: maxX - minX, width: maxZ - minZ };
}

export function createGymProps(): GymPropsHandle {
  const { mat, bench, dumbbells } = kitchenLayout();
  const group = new THREE.Group();
  group.name = 'gymCorner';

  const matMat = new THREE.MeshStandardMaterial({
    color: MAT_HEX,
    roughness: 0.9,
    metalness: 0.04,
  });
  const matMesh = new THREE.Mesh(
    new RoundedBoxGeometry(mat.hx * 2, mat.hy * 2, mat.hz * 2, 2, 1),
    matMat,
  );
  matMesh.name = 'gymMat';
  matMesh.position.set(mat.x, mat.y, mat.z);
  matMesh.rotation.y = mat.yaw;
  matMesh.castShadow = true;
  matMesh.receiveShadow = true;
  group.add(matMesh);

  const leather = new THREE.MeshStandardMaterial({
    color: LEATHER_HEX,
    roughness: 0.55,
    metalness: 0.06,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: FRAME_HEX,
    roughness: 0.42,
    metalness: 0.35,
  });
  const benchGroup = new THREE.Group();
  benchGroup.name = 'gymBench';
  benchGroup.position.set(bench.x, 0, bench.z);
  benchGroup.rotation.y = bench.yaw;
  const padH = mm(BENCH_MM.pad);
  const pad = new THREE.Mesh(
    new RoundedBoxGeometry(bench.hx * 2, padH, bench.hz * 2, 2, 1.4),
    leather,
  );
  pad.name = 'gymBenchPad';
  pad.position.set(0, mm(BENCH_MM.height) - padH / 2, 0);
  pad.castShadow = true;
  pad.receiveShadow = true;
  benchGroup.add(pad);
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(bench.hx * 2 * 0.92, 2.2, 4.2),
    frameMat,
  );
  rail.position.set(0, mm(BENCH_MM.height) - padH - 1.1, 0);
  rail.castShadow = true;
  rail.receiveShadow = true;
  benchGroup.add(rail);
  addAFrameLegs(benchGroup, -bench.hx * 0.72, mm(BENCH_MM.height) - padH, bench.hz * 2, frameMat);
  addAFrameLegs(benchGroup, bench.hx * 0.72, mm(BENCH_MM.height) - padH, bench.hz * 2, frameMat);
  group.add(benchGroup);

  dumbbells.forEach((d, i) => {
    const db = createDumbbell(d.length, mm(DUMBBELL_MM.plateRadius));
    db.name = `gymDumbbell${i}`;
    db.position.set(d.x, d.y, d.z);
    db.rotation.y = d.yaw;
    group.add(db);
  });

  return {
    group,
    dispose() {
      const seenGeo = new Set<THREE.BufferGeometry>();
      const seenMat = new Set<THREE.Material>();
      group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (!seenGeo.has(obj.geometry)) {
          seenGeo.add(obj.geometry);
          obj.geometry.dispose();
        }
        const list = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of list) {
          if (seenMat.has(m)) continue;
          seenMat.add(m);
          m.dispose();
        }
      });
    },
  };
}
