import * as THREE from 'three';
import { CURD_ALBEDO_HEX } from '../scene/scale.ts';

export function createTable(width = 420, depth = 340): THREE.Group {
  const group = new THREE.Group();
  group.name = 'kitchenTable';
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 0.9, metalness: 0.02 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  top.name = 'tableTop';
  group.add(top);
  return group;
}

/** @deprecated Wedge placeholder; live scene uses `createProceduralTwarog`. */
export function createTwarogWedge(albedoHex = CURD_ALBEDO_HEX): THREE.Mesh {
  const geom = new THREE.BoxGeometry(4, 3, 5);
  const mat = new THREE.MeshStandardMaterial({
    color: albedoHex,
    roughness: 0.92,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'twarog';
  return mesh;
}
