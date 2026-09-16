import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { kitchenLayout } from '../scene/layout.ts';
import type { RenderQuality } from '../scene/quality.ts';
import { DESKTOP_QUALITY } from '../scene/quality.ts';
import {
  OAK_HEX,
  PLATE_HEX,
  TABLE_BEVEL_MM,
  TABLE_THICKNESS_MM,
  fillContactAo,
  fillOakAlbedo,
  fillSimplexRoughness,
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
  spoon.position.set(
    restX - shadow * width * 0.72,
    3.4 + shadow * 26,
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
  decal.position.set(x, y + 0.12, z);
}

export function createKitchen(
  width = 420,
  depth = 340,
  quality: RenderQuality = DESKTOP_QUALITY,
): KitchenSet {
  const group = new THREE.Group();
  group.name = 'kitchenTable';
  const maps: THREE.Texture[] = [];
  const size = quality.textureSize;
  const oakData = new Uint8Array(size * size * 4);
  fillOakAlbedo(oakData, size, 9);
  const oakMap = dataTex(oakData, size, THREE.SRGBColorSpace);
  maps.push(oakMap);
  const oakRoughData = new Uint8Array(size * size * 4);
  fillSimplexRoughness(oakRoughData, size, 21, 168, 36);
  const oakRough = dataTex(oakRoughData, size, THREE.NoColorSpace);
  maps.push(oakRough);

  const table = new THREE.Mesh(
    beveledSlab(width, depth),
    new THREE.MeshPhysicalMaterial({
      color: OAK_HEX,
      map: oakMap,
      roughness: 0.72,
      roughnessMap: oakRough,
      metalness: 0.02,
      envMapIntensity: 0.45,
    }),
  );
  table.name = 'tableTop';
  table.receiveShadow = quality.shadows;
  table.castShadow = false;
  group.add(table);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1800),
    new THREE.MeshBasicMaterial({ color: 0x07080c }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -(TABLE_THICKNESS_MM + 10);
  floor.name = 'gridFloor';
  floor.receiveShadow = false;
  group.add(floor);

  const grid = new THREE.GridHelper(1600, 64, 0x2a3344, 0x12161c);
  grid.position.y = -(TABLE_THICKNESS_MM + 8);
  grid.name = 'darkGrid';
  group.add(grid);

  const layout = kitchenLayout();
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(58, 60, 1.5, 48),
    new THREE.MeshPhysicalMaterial({
      color: PLATE_HEX,
      roughness: 0.42,
      metalness: 0.04,
      clearcoat: 0.2,
      clearcoatRoughness: 0.35,
    }),
  );
  plate.name = 'cheesePlate';
  plate.scale.set(1.18, 1, 1.38);
  plate.position.set(layout.curd.x, 0.4, layout.curd.z);
  plate.receiveShadow = quality.shadows;
  group.add(plate);

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
  gagShadow.position.set(0, 0.2, 0);
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
    new THREE.PlaneGeometry(14, 9),
    new THREE.MeshBasicMaterial({
      map: aoMap,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  contactAo.rotation.x = -Math.PI / 2;
  contactAo.name = 'thoraxContactAo';
  contactAo.renderOrder = 7;
  contactAo.position.set(layout.fly.x, 0.12, layout.fly.z);
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
