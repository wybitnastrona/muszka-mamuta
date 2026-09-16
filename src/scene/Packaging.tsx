import * as THREE from 'three';
import { Xoshiro128ss } from '../brain/rng.ts';
import { SimplexNoise } from './simplex.ts';
import type { KitchenTextures, UvRect } from './textures.ts';
import {
  POUCH_BASE_HEIGHT_MM,
  POUCH_DEPTH_SEGMENTS,
  POUCH_FILM_THICKNESS,
  POUCH_MM,
  POUCH_WIDTH_SEGMENTS,
  POUCH_WRINKLE_MM,
  SEAL_MM,
  mm,
} from './scale.ts';

export type PackagingBuild = {
  group: THREE.Group;
  labelFront: THREE.Mesh;
  labelBack: THREE.Mesh;
};

const WRINKLE_FREQ = 0.2;
const DEPRESSION_MM = 1.65;
const TABLE_EPS = 0.12;
const FOLD_ANGLE = -2.55;
const ROUGH_MAP_SIZE = 256;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / Math.max(1e-8, e1 - e0)));
  return t * t * (3 - 2 * t);
}

function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  if (len2 < 1e-10) return Math.hypot(px - ax, pz - az);
  const t = Math.min(1, Math.max(0, ((px - ax) * vx + (pz - az) * vz) / len2));
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}

export function filmMaterial(
  envMap?: THREE.Texture | null,
  roughnessMap?: THREE.Texture | null,
  side: THREE.Side = THREE.FrontSide,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xc5d0d4,
    roughness: 0.25,
    metalness: 0,
    roughnessMap: roughnessMap ?? null,
    transmission: 0.9,
    thickness: POUCH_FILM_THICKNESS,
    ior: 1.5,
    envMapIntensity: 1.15,
    envMap: envMap ?? null,
    attenuationColor: new THREE.Color(0xd8e0e4),
    attenuationDistance: 4,
    opacity: 1,
    transparent: true,
    side,
    depthWrite: true,
  });
}

export function wrinkleRoughnessMap(seed: number, anisotropy: number): THREE.DataTexture {
  const size = ROUGH_MAP_SIZE;
  const data = new Uint8Array(size * size * 4);
  const noise = new SimplexNoise(seed + 91);
  const length = mm(POUCH_MM.length);
  const width = mm(POUCH_MM.width);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / (size - 1);
      const v = j / (size - 1);
      const x = (u - 0.5) * length;
      const z = (0.5 - v) * width;
      const n =
        noise.noise2(x * WRINKLE_FREQ, z * WRINKLE_FREQ) * 0.65 +
        noise.noise2(x * WRINKLE_FREQ * 2.4, z * WRINKLE_FREQ * 2.4) * 0.35;
      const r = Math.min(255, Math.max(0, Math.round(150 + n * 95)));
      const o = (j * size + i) * 4;
      data[o] = r;
      data[o + 1] = r;
      data[o + 2] = r;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

function flangeMask(x: number, z: number, hx: number, hz: number): number {
  const seal = mm(SEAL_MM);
  const edgeX = smoothstep(hx - seal, hx - 1.5, Math.abs(x));
  const edgeZ = smoothstep(hz - seal, hz - 1.5, Math.abs(z));
  return Math.max(edgeX, edgeZ);
}

function cornerLift(x: number, z: number, cx: number, cz: number, radius: number, amp: number): number {
  const d = Math.hypot(x - cx, z - cz);
  const w = 1 - smoothstep(0, radius, d);
  return amp * w * w;
}

type Crease = { ax: number; az: number; bx: number; bz: number; amp: number; sigma: number };

function makeCreases(seed: number, hx: number, hz: number): Crease[] {
  const rng = new Xoshiro128ss(seed + 17);
  const creases: Crease[] = [
    { ax: -hx * 0.42, az: -hz * 0.22, bx: hx * 0.48, bz: hz * 0.28, amp: 3.1, sigma: 1.7 },
    { ax: -hx * 0.18, az: hz * 0.5, bx: hx * 0.55, bz: -hz * 0.32, amp: -2.5, sigma: 1.55 },
  ];
  const extra = 2 + Math.floor(rng.nextFloat() * 2);
  for (let i = 0; i < extra; i++) {
    const ax = (rng.nextFloat() * 2 - 1) * hx * 0.78;
    const az = (rng.nextFloat() * 2 - 1) * hz * 0.78;
    const ang = rng.nextFloat() * Math.PI;
    const len = 42 + rng.nextFloat() * 55;
    let bx = ax + Math.cos(ang) * len;
    let bz = az + Math.sin(ang) * len;
    bx = Math.min(hx * 0.92, Math.max(-hx * 0.92, bx));
    bz = Math.min(hz * 0.92, Math.max(-hz * 0.92, bz));
    creases.push({
      ax,
      az,
      bx,
      bz,
      amp: (rng.nextFloat() < 0.5 ? -1 : 1) * (2.1 + rng.nextFloat() * 1.8),
      sigma: 1.55 + rng.nextFloat() * 1.2,
    });
  }
  return creases;
}

/**
 * Collapse a 130×110 mm plane into an empty vacuum pouch on the table.
 * Local +X is length, +Z width, +Y up.
 */
export function deformEmptyPouch(geometry: THREE.BufferGeometry, seed: number): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const noise = new SimplexNoise(seed);
  const hx = mm(POUCH_MM.length) / 2;
  const hz = mm(POUCH_MM.width) / 2;
  const base = mm(POUCH_BASE_HEIGHT_MM);
  const wrinkleAmp = mm(POUCH_WRINKLE_MM);
  const innerX = hx - mm(SEAL_MM);
  const innerZ = hz - mm(SEAL_MM);
  const creases = makeCreases(seed, hx, hz);
  const foldX = -hx + 26;
  const flapZ1 = -hz + 46;

  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i);
    const z0 = pos.getZ(i);
    const flange = flangeMask(x0, z0, hx, hz);
    const inner = 1 - flange;

    const nx = innerX > 1e-6 ? Math.abs(x0) / innerX : 1;
    const nz = innerZ > 1e-6 ? Math.abs(z0) / innerZ : 1;
    const bowl = 1 - smoothstep(0.72, 1.18, Math.max(nx, nz));
    let y = base - mm(DEPRESSION_MM) * bowl * bowl * inner;

    let crease = 0;
    for (const c of creases) {
      const d = distToSegment(x0, z0, c.ax, c.az, c.bx, c.bz);
      crease += c.amp * Math.exp(-((d / c.sigma) ** 2));
    }
    y += crease * (0.22 + 0.78 * inner);

    const n1 = noise.noise2(x0 * WRINKLE_FREQ, z0 * WRINKLE_FREQ);
    const n2 = noise.noise2(x0 * WRINKLE_FREQ * 2.4 + 8, z0 * WRINKLE_FREQ * 2.4);
    y += wrinkleAmp * (n1 * 0.7 + n2 * 0.3) * (0.18 + 0.82 * inner);

    y += cornerLift(x0, z0, hx, hz, 28, 3.4) * Math.max(flange, 0.35);
    y += cornerLift(x0, z0, hx, -hz, 26, 2.6) * Math.max(flange, 0.35);

    const dx = x0 - foldX;
    const along = 1 - smoothstep(flapZ1 - 8, flapZ1 + 4, z0);
    const t = smoothstep(foldX + 7, foldX - 3, x0) * along;
    let x = x0;
    let z = z0;
    if (t > 1e-4) {
      const ang = FOLD_ANGLE * t;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const yRel = y - base;
      x = foldX + dx * c - yRel * s;
      y = base + dx * s + yRel * c;
      z = z0 + t * 3.5;
    }

    if (y < TABLE_EPS) y = TABLE_EPS;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** Empty PET film: 40×32 subdivided plane, 130×110 mm, collapsed onto the table. */
export function pouchFilmGeometry(seed = 11): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(
    mm(POUCH_MM.length),
    mm(POUCH_MM.width),
    POUCH_WIDTH_SEGMENTS,
    POUCH_DEPTH_SEGMENTS,
  );
  geo.rotateX(-Math.PI / 2);
  deformEmptyPouch(geo, seed);
  return geo;
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
 * Map plane UVs into the photograph's opaque rect.
 *
 * Default (no `contain`): plane U → photo U, plane V → photo V, so a unit
 * test plane fills the opaque rect.
 *
 * `contain`: the standing-pack photo is rotated 90° onto the lying 130×110 mm
 * film (photo height along pouch +X, photo width along pouch ±Z) and fitted
 * without stretch. File top sits at local +X (sealed end). Outside the print,
 * UVs sample the transparent corner (0, 0).
 */
export function setPackLabelUVs(
  geometry: THREE.BufferGeometry,
  rect: UvRect,
  opts: { flipY?: boolean; mirrorU?: boolean; contain?: boolean } = {},
): void {
  const flipY = opts.flipY ?? true;
  const mirrorU = opts.mirrorU ?? false;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  let u0p = 0;
  let u1p = 1;
  let v0p = 0;
  let v1p = 1;
  const rotateToLength = !!opts.contain;
  if (opts.contain) {
    const faceL = mm(POUCH_MM.length);
    const faceW = mm(POUCH_MM.width);
    const margin = 0.93;
    let spanX = faceL * margin;
    let spanZ = spanX * rect.aspect;
    if (spanZ > faceW * margin) {
      spanZ = faceW * margin;
      spanX = spanZ / Math.max(1e-8, rect.aspect);
    }
    u0p = 0.5 - spanX / faceL / 2;
    u1p = 0.5 + spanX / faceL / 2;
    v0p = 0.5 - spanZ / faceW / 2;
    v1p = 0.5 + spanZ / faceW / 2;
  }
  for (let i = 0; i < uv.count; i++) {
    const pu = (uv.getX(i) - u0p) / Math.max(1e-8, u1p - u0p);
    const pv = (uv.getY(i) - v0p) / Math.max(1e-8, v1p - v0p);
    let su: number;
    let sv: number;
    if (rotateToLength) {
      su = pv;
      sv = 1 - pu;
    } else {
      su = pu;
      sv = pv;
    }
    if (mirrorU) su = 1 - su;
    if (su < -0.002 || su > 1.002 || sv < -0.002 || sv > 1.002) {
      uv.setXY(i, 0, 0);
      continue;
    }
    su = Math.min(1, Math.max(0, su));
    sv = Math.min(1, Math.max(0, sv));
    const u = rect.u0 + (rect.u1 - rect.u0) * su;
    const v = flipY
      ? (1 - rect.v0) + (rect.v0 - rect.v1) * sv
      : rect.v0 + (rect.v1 - rect.v0) * sv;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function labelMaterial(map: THREE.Texture, side: THREE.Side): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: true,
    alphaTest: 0.08,
    side,
    roughness: 0.48,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/**
 * Limp empty vacuum pouch on the table. Local +X is length, +Z width, +Y up.
 * Open / torn at local −X. Labels share the deformed film surface.
 */
export function createPackaging(
  textures: KitchenTextures,
  opts: { anisotropy: number; seed?: number; envMap?: THREE.Texture | null } = { anisotropy: 1 },
): PackagingBuild {
  const group = new THREE.Group();
  group.name = 'packaging';
  const seed = opts.seed ?? 11;
  const anisotropy = opts.anisotropy;
  const filmGeo = pouchFilmGeometry(seed);
  const roughnessMap = wrinkleRoughnessMap(seed, anisotropy);
  const filmFront = new THREE.Mesh(filmGeo, filmMaterial(opts.envMap, roughnessMap, THREE.FrontSide));
  filmFront.name = 'pouchFilm';
  filmFront.castShadow = true;
  filmFront.receiveShadow = true;
  filmFront.renderOrder = 2;
  const filmBack = new THREE.Mesh(filmGeo, filmMaterial(opts.envMap, roughnessMap, THREE.BackSide));
  filmBack.name = 'pouchFilmBack';
  filmBack.castShadow = false;
  filmBack.receiveShadow = true;
  filmBack.renderOrder = 2;
  group.add(filmFront, filmBack);

  prepareLabelMap(textures.packFront, anisotropy);
  prepareLabelMap(textures.packBack, anisotropy);

  const frontGeo = filmGeo.clone();
  setPackLabelUVs(frontGeo, textures.packFrontUv, {
    flipY: textures.packFront.flipY,
    contain: true,
  });
  const labelFront = new THREE.Mesh(frontGeo, labelMaterial(textures.packFront, THREE.FrontSide));
  labelFront.name = 'packLabelFront';
  labelFront.castShadow = false;
  labelFront.receiveShadow = false;
  labelFront.renderOrder = 3;

  const backGeo = filmGeo.clone();
  setPackLabelUVs(backGeo, textures.packBackUv, {
    flipY: textures.packBack.flipY,
    mirrorU: true,
    contain: true,
  });
  const labelBack = new THREE.Mesh(backGeo, labelMaterial(textures.packBack, THREE.BackSide));
  labelBack.name = 'packLabelBack';
  labelBack.castShadow = false;
  labelBack.receiveShadow = false;
  labelBack.renderOrder = 3;

  group.add(labelFront, labelBack);
  return { group, labelFront, labelBack };
}
