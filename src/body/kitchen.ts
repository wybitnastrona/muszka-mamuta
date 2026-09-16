import * as THREE from 'three';
import { TWAROG_MAMUTA_WANILIOWY } from '../food/foodProfile.ts';

export function createTable(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'kitchenTable';
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.88, metalness: 0.02 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  group.add(top);
  const grid = new THREE.GridHelper(1.6, 16, 0x2a2118, 0x2a2118);
  grid.position.y = 0.0004;
  group.add(grid);
  return group;
}

export function createTwarogWedge(albedoHex = TWAROG_MAMUTA_WANILIOWY.albedoHex): THREE.Mesh {
  const geom = new THREE.ConeGeometry(0.042, 0.034, 3);
  const mat = new THREE.MeshStandardMaterial({
    color: albedoHex,
    roughness: 0.92,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'twarog';
  mesh.rotation.x = Math.PI;
  mesh.rotation.y = 0.55;
  return mesh;
}
