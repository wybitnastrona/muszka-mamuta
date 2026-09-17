/**
 * Authored laboratory treadmill. Belt UV scrolls; the fly walks in place
 * toward a U-rail. Not a measured device.
 */
import * as THREE from 'three';
import { MILL_MM, MILL_WALK_MM_S, mm } from '../scene/scale.ts';
import { kitchenLayout } from '../scene/layout.ts';

/** Face +X (belt long axis / handrail). heading 0 is +Z. */
export const MILL_HEADING = Math.PI / 2;

/** Belt shorter than axle span so the rollers read as drums. */
export const MILL_BELT_SPAN = 0.65;

export function millBeltLengthMm(lengthMm = mm(MILL_MM.length)): number {
  return lengthMm * MILL_BELT_SPAN;
}

/** UV scroll along belt length. Authored; not a measured mill. */
export function millBeltScroll(
  offset: number,
  dt: number,
  speedMmS = MILL_WALK_MM_S,
  beltLengthMm = millBeltLengthMm(),
): number {
  const len = Math.max(1e-6, beltLengthMm);
  return (offset + (speedMmS / len) * dt) % 1;
}

export function millStandXz(): { x: number; z: number } {
  const mill = kitchenLayout().mill;
  return { x: mill.x + mill.hx * 0.32, z: mill.z };
}

export function millRailGripWorld(): { left: { x: number; y: number; z: number }; right: { x: number; y: number; z: number } } {
  const mill = kitchenLayout().mill;
  const railX = mill.x + mill.hx * 0.46;
  const y = mill.deckY + 16;
  const dz = mill.hz * 0.22;
  return {
    left: { x: railX, y, z: mill.z + dz },
    right: { x: railX, y, z: mill.z - dz },
  };
}

export function millConsoleLabel(distanceMm: number): string {
  return `${Math.round(Math.max(0, distanceMm))} mm`;
}

const MILL_ROLLER_R = 4.2;

/** Authored mill chassis height (pad top). Console sits on this face. */
export function millBaseHeightMm(): number {
  return Math.max(4, mm(MILL_MM.deck) - MILL_ROLLER_R - 0.6);
}

/**
 * Horizontal readout on the mill pad at the motor (−X) end — the tub-facing
 * chassis top that stays in the kitchen frame, flush with the pad.
 */
export function millConsoleLocalPose(): {
  x: number;
  y: number;
  z: number;
  rotX: number;
  width: number;
  depth: number;
  bezelH: number;
} {
  const L = mm(MILL_MM.length);
  const width = 28;
  const depth = 11;
  const bezelH = 0.8;
  return {
    x: -L * 0.40,
    y: millBaseHeightMm() + bezelH + 0.06,
    z: 0,
    rotX: -Math.PI / 2,
    width,
    depth,
    bezelH,
  };
}

export type TreadmillHandle = {
  group: THREE.Group;
  belt: THREE.Mesh;
  deckY: number;
  railGrip: { left: THREE.Vector3; right: THREE.Vector3 };
  update(dt: number, running: boolean, distanceMm?: number): void;
  dispose(): void;
};

/** High-contrast chevron: 3 bands along belt length, readable from the kitchen camera. */
export function millBeltChevron(u: number, v: number): boolean {
  const chev = (((u * 3 + (v - 0.5) * 0.45) % 1) + 1) % 1;
  return chev < 0.45;
}

function stripeTexture(): THREE.DataTexture {
  const w = 96;
  const h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const on = millBeltChevron(x / w, y / h);
      data[i] = on ? 248 : 16;
      data[i + 1] = on ? 196 : 18;
      data[i + 2] = on ? 32 : 22;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

function millConsoleTexture(): { tex: THREE.CanvasTexture; paint: (distanceMm: number) => void } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.needsUpdate = true;
  const paint = (distanceMm: number) => {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f2f6f0';
    ctx.font = 'bold 86px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(millConsoleLabel(distanceMm), canvas.width / 2, canvas.height / 2 + 4);
    tex.needsUpdate = true;
  };
  paint(0);
  return { tex, paint };
}

export function createTreadmill(): TreadmillHandle {
  const layout = kitchenLayout().mill;
  const group = new THREE.Group();
  group.name = 'labMill';
  group.position.set(layout.x, 0, layout.z);
  group.rotation.y = layout.yaw;

  const L = mm(MILL_MM.length);
  const W = mm(MILL_MM.width);
  const deck = mm(MILL_MM.deck);
  const rollerR = MILL_ROLLER_R;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.55, metalness: 0.25 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.32, metalness: 0.42 });
  const consoleMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.45, metalness: 0.2 });

  const baseH = millBaseHeightMm();
  const base = new THREE.Mesh(new THREE.BoxGeometry(L, baseH, W), frameMat);
  base.position.y = baseH / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const motor = new THREE.Mesh(new THREE.BoxGeometry(18, 10, W * 0.7), frameMat);
  motor.position.set(-L * 0.42, 5, 0);
  motor.castShadow = true;
  group.add(motor);

  const rollerGeo = new THREE.CylinderGeometry(rollerR, rollerR, W * 0.92, 16);
  rollerGeo.rotateX(Math.PI / 2);
  const rollerMat = new THREE.MeshStandardMaterial({ color: 0x6b7380, roughness: 0.4, metalness: 0.45 });
  const r1 = new THREE.Mesh(rollerGeo, rollerMat);
  const r2 = new THREE.Mesh(rollerGeo, rollerMat);
  r1.position.set(-L * 0.38, deck, 0);
  r2.position.set(L * 0.38, deck, 0);
  group.add(r1, r2);

  const tex = stripeTexture();
  const beltMat = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: 0xffffff,
    emissiveIntensity: 0.28,
    roughness: 0.62,
    metalness: 0.04,
    color: 0xffffff,
  });
  const beltH = 2.2;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(millBeltLengthMm(L), beltH, W * 0.72), beltMat);
  belt.position.y = deck;
  belt.receiveShadow = true;
  belt.castShadow = true;
  belt.name = 'millBelt';
  group.add(belt);

  const railGeo = new THREE.BoxGeometry(L * 0.8, 6, 2);
  const railL = new THREE.Mesh(railGeo, railMat);
  const railR = new THREE.Mesh(railGeo, railMat);
  railL.position.set(0, deck + 4, W * 0.42);
  railR.position.set(0, deck + 4, -W * 0.42);
  group.add(railL, railR);

  const postH = 22;
  const postGeo = new THREE.CylinderGeometry(1.4, 1.4, postH, 10);
  const postZ = W * 0.28;
  const postX = L * 0.46;
  const postLy = new THREE.Mesh(postGeo, railMat);
  const postRy = new THREE.Mesh(postGeo, railMat);
  postLy.position.set(postX, deck + postH / 2, postZ);
  postRy.position.set(postX, deck + postH / 2, -postZ);
  group.add(postLy, postRy);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, postZ * 2 + 2, 10), railMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(postX, deck + postH, 0);
  bar.castShadow = true;
  group.add(bar);

  const pose = millConsoleLocalPose();
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(pose.width + 2.4, pose.bezelH, pose.depth + 2.4),
    consoleMat,
  );
  bezel.name = 'millConsoleBezel';
  bezel.position.set(pose.x, baseH + pose.bezelH / 2, pose.z);
  bezel.receiveShadow = true;
  group.add(bezel);

  const screenKit = millConsoleTexture();
  const screenMat = new THREE.MeshBasicMaterial({
    map: screenKit?.tex ?? null,
    color: screenKit ? 0xffffff : 0x050505,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(pose.width, pose.depth), screenMat);
  screen.name = 'millConsoleScreen';
  screen.position.set(pose.x, pose.y, pose.z);
  screen.rotation.x = pose.rotX;
  screen.renderOrder = 2;
  group.add(screen);

  const grip = millRailGripWorld();
  const beltLen = millBeltLengthMm(L);

  return {
    group,
    belt,
    deckY: layout.deckY,
    railGrip: {
      left: new THREE.Vector3(grip.left.x, grip.left.y, grip.left.z),
      right: new THREE.Vector3(grip.right.x, grip.right.y, grip.right.z),
    },
    update(dt, running, distanceMm = 0) {
      screenKit?.paint(distanceMm);
      if (!running) return;
      const mat = belt.material as THREE.MeshStandardMaterial;
      const map = mat.map;
      if (map) {
        map.offset.x = millBeltScroll(map.offset.x, dt, MILL_WALK_MM_S, beltLen);
      }
      const spin = (MILL_WALK_MM_S / rollerR) * dt;
      r1.rotation.z -= spin;
      r2.rotation.z -= spin;
    },
    dispose() {
      tex.dispose();
      screenKit?.tex.dispose();
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else if (mat !== belt.material && mat !== screenMat) mat.dispose();
        }
      });
      (belt.material as THREE.MeshStandardMaterial).dispose();
      screenMat.dispose();
    },
  };
}
