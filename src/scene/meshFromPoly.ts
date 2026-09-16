import * as THREE from 'three';
import { cross, dot, type FaceTag, type Polyhedron, sub } from './polyhedron.ts';

export type MeshFromPoly = {
  geometry: THREE.BufferGeometry;
  hullVertexCount: number;
  cutVertexCount: number;
};

function faceUv(
  v: { x: number; y: number; z: number },
  n: { x: number; y: number; z: number },
  hx: number, hy: number, hz: number, tile: number,
): [number, number] {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ay >= ax && ay >= az) {
    return [((v.x / hx) * 0.5 + 0.5) * tile, ((v.z / hz) * 0.5 + 0.5) * tile];
  }
  if (ax >= az) {
    return [((v.z / hz) * 0.5 + 0.5) * tile, ((v.y / hy) * 0.5 + 0.5) * tile];
  }
  return [((v.x / hx) * 0.5 + 0.5) * tile, ((v.y / hy) * 0.5 + 0.5) * tile];
}

function faceNormal(poly: Polyhedron, indices: readonly number[]): { x: number; y: number; z: number } {
  const a = poly.vertices[indices[0]!]!;
  const b = poly.vertices[indices[1]!]!;
  const c = poly.vertices[indices[2]!]!;
  return cross(sub(b, a), sub(c, a));
}

function pushFace(
  poly: Polyhedron,
  face: { indices: number[]; tag: FaceTag },
  positions: number[],
  uvs: number[],
  hx: number, hy: number, hz: number, tile: number,
): number {
  const ids = face.indices;
  const n = faceNormal(poly, ids);
  let count = 0;
  for (let i = 1; i < ids.length - 1; i++) {
    const tri = [ids[0]!, ids[i]!, ids[i + 1]!];
    for (const id of tri) {
      const v = poly.vertices[id]!;
      positions.push(v.x, v.y, v.z);
      const uv = faceUv(v, n, hx, hy, hz, tile);
      uvs.push(uv[0], uv[1]);
      count++;
    }
  }
  return count;
}

export function meshFromPolyhedron(
  poly: Polyhedron,
  hx: number,
  hy: number,
  hz: number,
  tile = 1,
): MeshFromPoly {
  const hullPos: number[] = [];
  const hullUv: number[] = [];
  const cutPos: number[] = [];
  const cutUv: number[] = [];
  for (const face of poly.faces) {
    if (face.tag === 'cut') pushFace(poly, face, cutPos, cutUv, hx, hy, hz, tile);
    else pushFace(poly, face, hullPos, hullUv, hx, hy, hz, tile);
  }
  const positions = hullPos.concat(cutPos);
  const uvs = hullUv.concat(cutUv);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const hullVertexCount = hullPos.length / 3;
  const cutVertexCount = cutPos.length / 3;
  if (hullVertexCount > 0) geometry.addGroup(0, hullVertexCount, 0);
  if (cutVertexCount > 0) geometry.addGroup(hullVertexCount, cutVertexCount, 1);
  return { geometry, hullVertexCount, cutVertexCount };
}
