/**
 * Authored laboratory treadmill. Belt UV scrolls; the fly walks in place
 * toward a front console lean-bar. Not a measured device.
 */
import * as THREE from 'three';
import { MILL_MM, MILL_WALK_MM_S, flyVisualLengthMm, mm } from '../scene/scale.ts';
import { kitchenLayout } from '../scene/layout.ts';

/** Face +X (belt long axis / front console). heading 0 is +Z. */
export const MILL_HEADING = Math.PI / 2;

/** Authored walking-pad pitch: front console (+X) is uphill. 0.0611 rad = 3.50°. */
export const MILL_INCLINE_RAD = 0.0611;

/** Belt shorter than axle span so the rollers read as drums. */
export const MILL_BELT_SPAN = 0.65;

/** Roller radius (mm). Axes sit at `MILL_MM.deck`. */
export const MILL_ROLLER_R = 4.2;

/** Belt slab thickness (mm). Top is tangent to the roller tops. */
export const MILL_BELT_H = 2.2;

/** Chamfered chassis height (mm). */
export const MILL_PLINTH_H = 16;

/** Top-edge chamfer on the moulded plinth (mm). */
export const MILL_CHAMFER_MM = 2;

export function millBeltLengthMm(lengthMm = mm(MILL_MM.length)): number {
  return lengthMm * MILL_BELT_SPAN;
}

/** Local Y of the belt top (= roller top). Walking surface / IK / LAND_MILL. */
export function millBeltTopLocalY(): number {
  return mm(MILL_MM.deck) + MILL_ROLLER_R;
}

/** Local Y of the belt mesh centre so the top is tangent to the drums. */
export function millBeltCenterLocalY(): number {
  return millBeltTopLocalY() - MILL_BELT_H / 2;
}

/** Lean-bar local Y: thorax height of the 15 mm fly standing on the belt. */
export function millConsoleGripLocalY(): number {
  return millBeltTopLocalY() + flyVisualLengthMm() * 0.55;
}

/** Local +X of the front console (just past the uphill belt end). */
export function millConsoleLocalX(): number {
  return millBeltLengthMm() / 2 + 3;
}

/** UV scroll along belt length. Authored; not a measured mill. */
export function millBeltScroll(
  offset: number,
  dt: number,
  speedMmS = MILL_WALK_MM_S,
  beltLengthMm = millBeltLengthMm(),
): number {
  const len = Math.max(1e-6, beltLengthMm);
  return (((offset - (speedMmS / len) * dt) % 1) + 1) % 1;
}

export function millStandXz(): { x: number; z: number } {
  const mill = kitchenLayout().mill;
  const fly = flyVisualLengthMm();
  return { x: mill.x + millConsoleLocalX() - fly * 0.55, z: mill.z };
}

/** World Y of the belt after the authored uphill pitch. */
export function millSurfaceY(worldX: number, localY?: number): number {
  const mill = kitchenLayout().mill;
  const L = mm(MILL_MM.length);
  const y0 = localY ?? millBeltTopLocalY();
  const lx = worldX - mill.x;
  const pivot = (L / 2) * Math.sin(MILL_INCLINE_RAD);
  return pivot + lx * Math.sin(MILL_INCLINE_RAD) + y0 * Math.cos(MILL_INCLINE_RAD);
}

function millGripHalfZ(): number {
  return flyVisualLengthMm() * 0.38;
}

export function millConsoleGripWorld(): {
  left: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
} {
  const mill = kitchenLayout().mill;
  const railX = mill.x + millConsoleLocalX();
  const y = millSurfaceY(railX, millConsoleGripLocalY());
  const dz = millGripHalfZ();
  return {
    left: { x: railX, y, z: mill.z + dz },
    right: { x: railX, y, z: mill.z - dz },
  };
}

/** @deprecated Alias of millConsoleGripWorld (front lean-bar, not a side U-rail). */
export function millRailGripWorld(): {
  left: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
} {
  return millConsoleGripWorld();
}

/** Authored reel odometer: millimetres shown as km so the LED ticks on-camera. */
export function millConsoleLabel(distanceMm: number): string {
  return `${(Math.max(0, distanceMm) / 1000).toFixed(2)} km`;
}

/** Moulded chassis height. Replaces the 7.2 mm sliver under the drums. */
export function millBaseHeightMm(): number {
  return MILL_PLINTH_H;
}

/**
 * Back-tilted LED at the uphill (+X) belt end, facing the kitchen camera (−Z).
 * Size is derived from flyVisualLengthMm(); thorax height sets the lean-bar.
 */
export function millConsoleLocalPose(): {
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  width: number;
  depth: number;
  bezelH: number;
} {
  const fly = flyVisualLengthMm();
  const width = fly * 1.4;
  const depth = fly * 0.72;
  const bezelH = 1.6;
  const stemD = fly * 0.48;
  return {
    x: millConsoleLocalX(),
    y: millConsoleGripLocalY() + depth * 0.28,
    z: -stemD / 2 - 0.25,
    rotX: -0.32,
    rotY: Math.PI,
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
  consoleGrip: { left: THREE.Vector3; right: THREE.Vector3 };
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
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.needsUpdate = true;
  const paint = (distanceMm: number) => {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.shadowColor = '#ff2a1a';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ff2a1a';
    ctx.font = 'bold 92px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(millConsoleLabel(distanceMm), canvas.width / 2, canvas.height / 2 + 4);
    ctx.shadowBlur = 0;
    tex.needsUpdate = true;
  };
  paint(0);
  return { tex, paint };
}

function millPlinthGeometry(length: number, width: number, height: number, chamfer: number): THREE.BufferGeometry {
  const hw = length / 2 - chamfer;
  const hd = width / 2 - chamfer;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hd);
  shape.lineTo(hw, -hd);
  shape.lineTo(hw, hd);
  shape.lineTo(-hw, hd);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.2, height - 2 * chamfer),
    bevelEnabled: true,
    bevelThickness: chamfer,
    bevelSize: chamfer,
    bevelSegments: 2,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  const minY = geo.boundingBox?.min.y ?? 0;
  geo.translate(0, -minY, 0);
  return geo;
}

export function createTreadmill(): TreadmillHandle {
  const layout = kitchenLayout().mill;
  const group = new THREE.Group();
  group.name = 'labMill';
  const L = mm(MILL_MM.length);
  group.position.set(layout.x, (L / 2) * Math.sin(MILL_INCLINE_RAD), layout.z);
  group.rotation.y = layout.yaw;
  group.rotation.z = MILL_INCLINE_RAD;
  const W = mm(MILL_MM.width);
  const deck = mm(MILL_MM.deck);
  const rollerR = MILL_ROLLER_R;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x161b22, roughness: 0.48, metalness: 0.28 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.32, metalness: 0.42 });
  const consoleMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.45, metalness: 0.2 });

  const baseH = millBaseHeightMm();
  const base = new THREE.Mesh(millPlinthGeometry(L, W, baseH, MILL_CHAMFER_MM), frameMat);
  base.name = 'millBase';
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const beltLen = millBeltLengthMm(L);
  const rollerGeo = new THREE.CylinderGeometry(rollerR, rollerR, W * 0.92, 16);
  rollerGeo.rotateX(Math.PI / 2);
  const rollerMat = new THREE.MeshStandardMaterial({ color: 0x6b7380, roughness: 0.4, metalness: 0.45 });
  const r1 = new THREE.Mesh(rollerGeo, rollerMat);
  const r2 = new THREE.Mesh(rollerGeo, rollerMat);
  r1.name = 'millRollerBack';
  r2.name = 'millRollerFront';
  r1.position.set(-beltLen / 2, deck, 0);
  r2.position.set(beltLen / 2, deck, 0);
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
  const beltH = MILL_BELT_H;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(beltLen, beltH, W * 0.72), beltMat);
  belt.position.y = millBeltCenterLocalY();
  belt.receiveShadow = true;
  belt.castShadow = true;
  belt.name = 'millBelt';
  group.add(belt);

  const fly = flyVisualLengthMm();
  const pose = millConsoleLocalPose();
  const stemW = fly * 0.36;
  const stemD = fly * 0.48;
  const gripY = millConsoleGripLocalY();
  const stemH = Math.max(2, gripY - baseH);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(stemW, stemH, stemD), consoleMat);
  stem.name = 'millConsoleStem';
  stem.position.set(pose.x, baseH + stemH / 2, 0);
  stem.castShadow = true;
  group.add(stem);

  const barLen = millGripHalfZ() * 2 + 2;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, barLen, 12), railMat);
  bar.name = 'millConsoleBar';
  bar.rotation.x = Math.PI / 2;
  bar.position.set(pose.x, gripY, 0);
  bar.castShadow = true;
  group.add(bar);

  const consoleRoot = new THREE.Group();
  consoleRoot.name = 'millConsole';
  consoleRoot.position.set(pose.x, pose.y, pose.z);
  consoleRoot.rotation.x = pose.rotX;
  consoleRoot.rotation.y = pose.rotY;
  group.add(consoleRoot);

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(pose.width + 2.6, pose.depth + 2.6, pose.bezelH),
    consoleMat,
  );
  bezel.name = 'millConsoleBezel';
  bezel.position.z = -pose.bezelH * 0.5 - 0.15;
  bezel.receiveShadow = true;
  consoleRoot.add(bezel);

  const screenKit = millConsoleTexture();
  const screenMat = new THREE.MeshBasicMaterial({
    map: screenKit?.tex ?? null,
    color: screenKit ? 0xffffff : 0x050505,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(pose.width, pose.depth), screenMat);
  screen.name = 'millConsoleScreen';
  screen.position.z = 0.06;
  screen.renderOrder = 2;
  consoleRoot.add(screen);

  const grip = millConsoleGripWorld();
  const gripVecs = {
    left: new THREE.Vector3(grip.left.x, grip.left.y, grip.left.z),
    right: new THREE.Vector3(grip.right.x, grip.right.y, grip.right.z),
  };

  return {
    group,
    belt,
    deckY: millBeltTopLocalY(),
    railGrip: gripVecs,
    consoleGrip: gripVecs,
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
