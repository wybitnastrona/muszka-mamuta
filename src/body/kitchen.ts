import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { kitchenLayout } from '../scene/layout.ts';
import type { RenderQuality } from '../scene/quality.ts';
import { DESKTOP_QUALITY } from '../scene/quality.ts';
import {
  LAB_DECK_HEX,
  TABLE_BEVEL_MM,
  TABLE_THICKNESS_MM,
  fillContactAo,
} from '../scene/proceduralMaps.ts';

export type KitchenSet = {
  group: THREE.Group;
  table: THREE.Mesh;
  plate: THREE.Mesh;
  spoon: THREE.Mesh;
  gagShadow: THREE.Mesh;
  contactAo: THREE.Mesh;
  maps: THREE.Texture[];
};

function dataTex(data: Uint8Array, size: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function beveledSlab(width: number, depth: number): THREE.BufferGeometry {
  const inset = TABLE_BEVEL_MM;
  const hw = width / 2 - inset;
  const hd = depth / 2 - inset;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hd);
  shape.lineTo(hw, -hd);
  shape.lineTo(hw, hd);
  shape.lineTo(-hw, hd);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: TABLE_THICKNESS_MM,
    bevelEnabled: true,
    bevelThickness: TABLE_BEVEL_MM,
    bevelSize: TABLE_BEVEL_MM,
    bevelSegments: 2,
    steps: 1,
  });
  geo.rotateX(Math.PI / 2);
  geo.computeBoundingBox();
  const top = geo.boundingBox?.max.y ?? 0;
  geo.translate(0, -top, 0);
  return geo;
}

function makeSpoonGeometry(): THREE.BufferGeometry {
  const handle = new THREE.CylinderGeometry(2.1, 2.6, 96, 10);
  handle.rotateZ(Math.PI / 2);
  handle.translate(-38, 0, 0);
  const neck = new THREE.CylinderGeometry(1.6, 3.4, 16, 8);
  neck.rotateZ(Math.PI / 2);
  neck.translate(14, 0, 0);
  const bowl = new THREE.SphereGeometry(15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  bowl.scale(1, 0.16, 1.35);
  bowl.rotateZ(-0.15);
  bowl.translate(32, 1.2, 0);
  const merged = mergeGeometries([handle, neck, bowl], false);
  handle.dispose();
  neck.dispose();
  bowl.dispose();
  if (!merged) {
    return new THREE.CylinderGeometry(2.2, 2.2, 90, 8);
  }
  merged.computeVertexNormals();
  return merged;
}

export function poseSpoon(
  spoon: THREE.Object3D,
  width: number,
  depth: number,
  shadow: number,
): void {
  const restX = width * 0.44;
  const restZ = -depth * 0.32;
  const topY = kitchenLayout().board.topY;
  spoon.position.set(
    restX - shadow * width * 0.72,
    topY + 3.4 + shadow * 26,
    restZ + shadow * 18,
  );
  spoon.rotation.set(-0.1, 0.42 + shadow * 0.35, 1.12);
}

export function poseContactAo(
  decal: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  visible: boolean,
): void {
  decal.visible = visible;
  decal.position.set(x, y + 0.22, z);
}

export type ShadowSurfaceY = {
  name: string;
  minY: number;
  maxY: number;
};

export type CoplanarShadowPair = {
  a: string;
  b: string;
  yA: number;
  yB: number;
  gap: number;
};

/** World AABB of shadow-receiving meshes that overlap `footprint` in XZ. */
export function shadowReceiverSurfaces(
  root: THREE.Object3D,
  footprint: THREE.Box3,
): ShadowSurfaceY[] {
  root.updateMatrixWorld(true);
  const out: ShadowSurfaceY[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.receiveShadow || !obj.visible) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.max.x < footprint.min.x || box.min.x > footprint.max.x) return;
    if (box.max.z < footprint.min.z || box.min.z > footprint.max.z) return;
    out.push({
      name: obj.name || obj.uuid.slice(0, 8),
      minY: box.min.y,
      maxY: box.max.y,
    });
  });
  return out;
}

export function coplanarShadowPairs(
  surfaces: ShadowSurfaceY[],
  eps = 0.05,
): CoplanarShadowPair[] {
  const hits: CoplanarShadowPair[] = [];
  for (let i = 0; i < surfaces.length; i++) {
    for (let j = i + 1; j < surfaces.length; j++) {
      const a = surfaces[i]!;
      const b = surfaces[j]!;
      const gap = Math.abs(a.maxY - b.maxY);
      if (gap < eps) hits.push({ a: a.name, b: b.name, yA: a.maxY, yB: b.maxY, gap });
    }
  }
  return hits;
}

export function createKitchen(
  width = 420,
  depth = 340,
  quality: RenderQuality = DESKTOP_QUALITY,
): KitchenSet {
  const group = new THREE.Group();
  group.name = 'kitchenTable';
  const maps: THREE.Texture[] = [];
  const deckMat = new THREE.MeshStandardMaterial({
    color: LAB_DECK_HEX,
    roughness: 0.85,
    metalness: 0.04,
  });

  const table = new THREE.Mesh(beveledSlab(width, depth), deckMat);
  table.name = 'tableBulk';
  table.receiveShadow = quality.shadows;
  table.castShadow = false;
  group.add(table);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({
      color: LAB_DECK_HEX,
      roughness: 0.85,
      metalness: 0.02,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -(TABLE_THICKNESS_MM + 10);
  floor.name = 'labFloor';
  floor.receiveShadow = quality.shadows;
  group.add(floor);

  const layout = kitchenLayout();
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  plate.name = 'labUnusedPlate';

  const spoon = new THREE.Mesh(
    makeSpoonGeometry(),
    new THREE.MeshPhysicalMaterial({
      color: 0xc9c4b8,
      metalness: 0.86,
      roughness: 0.28,
      envMapIntensity: 1,
    }),
  );
  spoon.name = 'scaleSpoon';
  spoon.visible = false;
  spoon.castShadow = quality.shadows;
  poseSpoon(spoon, width, depth, 0);
  group.add(spoon);

  const gagShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 70),
    new THREE.MeshBasicMaterial({
      color: 0x050608,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  gagShadow.rotation.x = -Math.PI / 2;
  gagShadow.position.set(0, layout.board.topY + 0.2, 0);
  gagShadow.name = 'spoonGagShadow';
  gagShadow.visible = false;
  gagShadow.renderOrder = 8;
  group.add(gagShadow);

  const aoData = new Uint8Array(256 * 256 * 4);
  fillContactAo(aoData, 256);
  const aoMap = dataTex(aoData, 256, THREE.SRGBColorSpace);
  aoMap.wrapS = THREE.ClampToEdgeWrapping;
  aoMap.wrapT = THREE.ClampToEdgeWrapping;
  maps.push(aoMap);
  const contactAo = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 20),
    new THREE.MeshBasicMaterial({
      map: aoMap,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  );
  contactAo.rotation.x = -Math.PI / 2;
  contactAo.name = 'thoraxContactAo';
  contactAo.renderOrder = 7;
  contactAo.position.set(layout.fly.x, layout.board.topY + 0.12, layout.fly.z);
  group.add(contactAo);

  return { group, table, plate, spoon, gagShadow, contactAo, maps };
}

export function createTable(width = 420, depth = 340): THREE.Group {
  return createKitchen(width, depth).group;
}

export function kitchenDrawCount(group: THREE.Object3D): number {
  let n = 0;
  group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh || (obj as THREE.LineSegments).isLineSegments) n += 1;
  });
  return n;
}
