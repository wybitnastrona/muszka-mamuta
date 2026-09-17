/**
 * Authored laboratory treadmill. Belt UV scrolls; the fly walks in place.
 * Not a measured device.
 */
import * as THREE from 'three';
import { FLY_WALK_MM_S, MILL_MM, mm } from '../scene/scale.ts';
import { kitchenLayout } from '../scene/layout.ts';

/** UV scroll along belt length. Authored; not a measured mill. */
export function millBeltScroll(
  offset: number,
  dt: number,
  speedMmS = FLY_WALK_MM_S,
  beltLengthMm = mm(MILL_MM.length) * 0.78,
): number {
  const len = Math.max(1e-6, beltLengthMm);
  return (offset + (speedMmS / len) * dt) % 1;
}

export type TreadmillHandle = {
  group: THREE.Group;
  belt: THREE.Mesh;
  deckY: number;
  update(dt: number, running: boolean): void;
  dispose(): void;
};

function stripeTexture(): THREE.DataTexture {
  const w = 64;
  const h = 16;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const band = Math.floor(x / 8) % 2 === 0;
      const v = band ? 48 : 28;
      data[i] = v;
      data[i + 1] = v + 4;
      data[i + 2] = v + 8;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createTreadmill(): TreadmillHandle {
  const layout = kitchenLayout().mill;
  const group = new THREE.Group();
  group.name = 'labMill';
  group.position.set(layout.x, 0, layout.z);
  group.rotation.y = layout.yaw;

  const L = mm(MILL_MM.length);
  const W = mm(MILL_MM.width);
  const H = mm(MILL_MM.height);
  const deck = mm(MILL_MM.deck);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.55, metalness: 0.25 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.4 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(L, H * 0.45, W), frameMat);
  base.position.y = H * 0.22;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const motor = new THREE.Mesh(new THREE.BoxGeometry(18, 16, W * 0.7), frameMat);
  motor.position.set(-L * 0.42, 10, 0);
  motor.castShadow = true;
  group.add(motor);

  const rollerGeo = new THREE.CylinderGeometry(3.2, 3.2, W * 0.92, 16);
  rollerGeo.rotateX(Math.PI / 2);
  const rollerMat = new THREE.MeshStandardMaterial({ color: 0x6b7380, roughness: 0.4, metalness: 0.45 });
  const r1 = new THREE.Mesh(rollerGeo, rollerMat);
  const r2 = new THREE.Mesh(rollerGeo, rollerMat);
  r1.position.set(-L * 0.36, deck, 0);
  r2.position.set(L * 0.36, deck, 0);
  group.add(r1, r2);

  const tex = stripeTexture();
  tex.repeat.set(L / 12, 1);
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(L * 0.78, 1.2, W * 0.78),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.05 }),
  );
  belt.position.y = deck;
  belt.receiveShadow = true;
  belt.name = 'millBelt';
  group.add(belt);

  const railGeo = new THREE.BoxGeometry(L * 0.8, 6, 2);
  const railL = new THREE.Mesh(railGeo, railMat);
  const railR = new THREE.Mesh(railGeo, railMat);
  railL.position.set(0, deck + 4, W * 0.42);
  railR.position.set(0, deck + 4, -W * 0.42);
  group.add(railL, railR);

  return {
    group,
    belt,
    deckY: layout.deckY,
    update(dt, running) {
      if (!running) return;
      const mat = belt.material as THREE.MeshStandardMaterial;
      const map = mat.map;
      if (!map) return;
      map.offset.x = millBeltScroll(map.offset.x, dt, FLY_WALK_MM_S, L * 0.78);
    },
    dispose() {
      tex.dispose();
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else if (mat !== belt.material) mat.dispose();
        }
      });
      (belt.material as THREE.MeshStandardMaterial).dispose();
    },
  };
}
