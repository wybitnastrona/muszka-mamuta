import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplexNoise } from './simplex.ts';
import { labelPlaneSize } from './layout.ts';
import type { KitchenTextures, UvRect } from './textures.ts';
import {
  LABEL_LIFT_MM,
  POUCH_BEVEL_MM,
  POUCH_FILM_THICKNESS,
  POUCH_FLANGE_THICK_MM,
  POUCH_MM,
  POUCH_WRINKLE_MM,
  SEAL_MM,
  mm,
} from './scale.ts';

export type PackagingBuild = {
  group: THREE.Group;
  labelFront: THREE.Mesh;
  labelBack: THREE.Mesh;
};

export function filmMaterial(envMap?: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xa8b6be,
    roughness: 0.15,
    metalness: 0,
    transmission: 0.85,
    thickness: POUCH_FILM_THICKNESS,
    ior: 1.5,
    envMapIntensity: 0.6,
    envMap: envMap ?? null,
    opacity: 1,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/** Drop triangles whose averaged vertex normal points along `dir` (open the pouch). */
export function dropFacesByNormal(
  geo: THREE.BufferGeometry,
  dir: THREE.Vector3,
  minDot = 0.72,
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const idx = geo.getIndex();
  const keepPos: number[] = [];
  const keepNrm: number[] = [];
  const keepUv: number[] = [];
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  dir.normalize();
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const dx = (nrm.getX(a) + nrm.getX(b) + nrm.getX(c)) / 3;
    const dy = (nrm.getY(a) + nrm.getY(b) + nrm.getY(c)) / 3;
    const dz = (nrm.getZ(a) + nrm.getZ(b) + nrm.getZ(c)) / 3;
    const len = Math.hypot(dx, dy, dz) || 1;
    if ((dx * dir.x + dy * dir.y + dz * dir.z) / len > minDot) continue;
    for (const i of [a, b, c]) {
      keepPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      keepNrm.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      if (uv) keepUv.push(uv.getX(i), uv.getY(i));
    }
  }
  geo.setIndex(null);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(keepPos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(keepNrm, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(keepUv, 2));
  geo.clearGroups();
}

export function wrinkleY(geometry: THREE.BufferGeometry, seed: number): void {
  const noise = new SimplexNoise(seed);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const amp = mm(POUCH_WRINKLE_MM);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setY(i, y + noise.noise2(x * 0.065, z * 0.065) * amp);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function roundedRectShape(width: number, depth: number, radius: number): THREE.Shape {
  const hw = width / 2;
  const hd = depth / 2;
  const r = Math.min(radius, hw * 0.45, hd * 0.45);
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hd);
  s.lineTo(hw - r, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + r);
  s.lineTo(hw, hd - r);
  s.quadraticCurveTo(hw, hd, hw - r, hd);
  s.lineTo(-hw + r, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - r);
  s.lineTo(-hw, -hd + r);
  s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  return s;
}

function filmCap(y: number, seed?: number): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(
    roundedRectShape(mm(POUCH_MM.length), mm(POUCH_MM.width), mm(POUCH_BEVEL_MM)),
    24,
  );
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  if (seed !== undefined) wrinkleY(geo, seed);
  else geo.computeVertexNormals();
  return geo;
}

function filmWall(w: number, h: number, d: number, x: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, 0, z);
  return geo;
}

/**
 * Thin open pouch: rounded top + bottom film, three side walls, −X open.
 * 130×110×32 mm, 4 mm corner radius, 1.5 mm top wrinkle.
 */
export function pouchFilmGeometry(seed = 11): THREE.BufferGeometry {
  const hy = mm(POUCH_MM.height) / 2;
  const hx = mm(POUCH_MM.length) / 2;
  const hz = mm(POUCH_MM.width) / 2;
  const wall = 0.7;
  const sideH = mm(POUCH_MM.height) - 1;
  const top = filmCap(hy, seed);
  const bottom = filmCap(-hy);
  const far = filmWall(wall, sideH, mm(POUCH_MM.width) - mm(POUCH_BEVEL_MM) * 2, hx - wall / 2, 0);
  const left = filmWall(mm(POUCH_MM.length) - mm(POUCH_BEVEL_MM), sideH, wall, 0, hz - wall / 2);
  const right = filmWall(mm(POUCH_MM.length) - mm(POUCH_BEVEL_MM), sideH, wall, 0, -(hz - wall / 2));
  const parts = [top, bottom, far, left, right].map((g) => {
    g.computeVertexNormals();
    return g.index ? g.toNonIndexed() : g;
  });
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('pouch film merge failed');
  return merged;
}

function prepareLabelMap(map: THREE.Texture, anisotropy: number): void {
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = anisotropy;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
}

/**
 * Planar UVs: photograph U follows pouch +X, V follows pouch +Z (after the
 * plane is laid flat). Transparent letterbox is cropped via `rect`.
 * Image top maps to world +Z so text is upright in Widok kuchni.
 */
export function setPackLabelUVs(
  geometry: THREE.BufferGeometry,
  rect: UvRect,
  opts: { flipY?: boolean; mirrorU?: boolean } = {},
): void {
  const flipY = opts.flipY ?? true;
  const mirrorU = opts.mirrorU ?? false;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const len = Math.max(1e-8, maxX - minX);
  const wid = Math.max(1e-8, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const sx = (pos.getX(i) - minX) / len;
    const sy = (pos.getY(i) - minY) / wid;
    const uSrc = mirrorU ? 1 - sx : sx;
    const u = rect.u0 + (rect.u1 - rect.u0) * uSrc;
    const v = flipY
      ? (1 - rect.v0) + (rect.v0 - rect.v1) * sy
      : rect.v0 + (rect.v1 - rect.v0) * sy;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function labelPlane(
  map: THREE.Texture,
  rect: UvRect,
  width: number,
  height: number,
  y: number,
  faceDown: boolean,
): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const geometry = new THREE.PlaneGeometry(width, height);
  setPackLabelUVs(geometry, rect, { flipY: map.flipY, mirrorU: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = faceDown ? Math.PI / 2 : -Math.PI / 2;
  if (faceDown) mesh.rotation.z = Math.PI;
  mesh.position.y = y;
  mesh.renderOrder = 3;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Flat vacuum pouch on the table. Local +X is length, +Z width, +Y height.
 * Open at local −X (no film wall, no seal flange on that end).
 */
export function createPackaging(
  textures: KitchenTextures,
  opts: { anisotropy: number; seed?: number; envMap?: THREE.Texture | null } = { anisotropy: 1 },
): PackagingBuild {
  const group = new THREE.Group();
  group.name = 'packaging';
  const film = filmMaterial(opts.envMap);
  const hy = mm(POUCH_MM.height) / 2;
  const hx = mm(POUCH_MM.length) / 2;
  const hz = mm(POUCH_MM.width) / 2;
  const body = new THREE.Mesh(pouchFilmGeometry(opts.seed ?? 11), film);
  body.name = 'pouchFilm';
  body.castShadow = true;
  body.receiveShadow = false;
  group.add(body);

  const seal = mm(SEAL_MM);
  const thick = mm(POUCH_FLANGE_THICK_MM);
  const flangeY = -hy + thick / 2;
  const addFlange = (w: number, d: number, x: number, z: number, name: string) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, thick, d), film);
    mesh.position.set(x, flangeY, z);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
  };
  addFlange(seal, mm(POUCH_MM.width), hx + seal / 2, 0, 'flangeFar');
  addFlange(mm(POUCH_MM.length) + seal, seal, seal / 2, hz + seal / 2, 'flangeLeft');
  addFlange(mm(POUCH_MM.length) + seal, seal, seal / 2, -(hz + seal / 2), 'flangeRight');

  prepareLabelMap(textures.packFront, opts.anisotropy);
  prepareLabelMap(textures.packBack, opts.anisotropy);
  const frontSize = labelPlaneSize(textures.packFrontUv.aspect);
  const backSize = labelPlaneSize(textures.packBackUv.aspect);
  const labelY = hy + mm(POUCH_WRINKLE_MM) + mm(LABEL_LIFT_MM);
  const labelFront = labelPlane(
    textures.packFront,
    textures.packFrontUv,
    frontSize.length,
    frontSize.width,
    labelY,
    false,
  );
  labelFront.name = 'packLabelFront';
  const labelBack = labelPlane(
    textures.packBack,
    textures.packBackUv,
    backSize.length,
    backSize.width,
    -hy - mm(LABEL_LIFT_MM),
    true,
  );
  labelBack.name = 'packLabelBack';
  group.add(labelFront, labelBack);

  return { group, labelFront, labelBack };
}
