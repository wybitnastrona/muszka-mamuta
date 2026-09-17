/**
 * Authored cutting-board mesh. The end-grain photo is a perspective-corrected
 * shot of the real board; grain, normals and the MIREXA decal are not
 * connectome data.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { asset } from '../lib/atlas.ts';
import {
  BOARD_EDGE_RADIUS_MM,
  BOARD_LOGO_WIDTH_MM,
  BOARD_MM,
  BOARD_YAW_DEG,
  mm,
} from './scale.ts';
import { kitchenLayout } from './layout.ts';
import {
  fillLongGrainOak,
  luminanceToNormalMap,
  medianRgbFromRgba,
} from './proceduralMaps.ts';
import type { RenderQuality } from './quality.ts';
import { DESKTOP_QUALITY } from './quality.ts';
import { bitmapRgba, opaqueUvFromBitmap } from './textures.ts';

export type BoardMaps = {
  top: THREE.Texture;
  topNormal: THREE.Texture;
  logo: THREE.Texture;
  logoAspect: number;
  median: THREE.Color;
};

export type CuttingBoardBuild = {
  group: THREE.Group;
  body: THREE.Mesh;
  logo: THREE.Mesh;
  maps: THREE.Texture[];
};

const DEG = Math.PI / 180;
const LOGO_LIFT_MM = 0.18;

function dataTex(data: Uint8Array, width: number, height: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

async function loadImage(path: string, label: string, colorSpace: THREE.ColorSpace, signal?: AbortSignal): Promise<THREE.Texture> {
  const response = await fetch(asset(path), { signal });
  if (!response.ok) {
    throw new Error(`Missing board texture ${label} (${path}): HTTP ${response.status}`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

export async function loadBoardMaps(signal?: AbortSignal, anisotropy = 1): Promise<BoardMaps> {
  const [top, logo] = await Promise.all([
    loadImage('textures/board/board_top.jpg', 'board_top', THREE.SRGBColorSpace, signal),
    loadImage('textures/board/board_logo_decal.png', 'board_logo', THREE.SRGBColorSpace, signal),
  ]);
  top.wrapS = THREE.ClampToEdgeWrapping;
  top.wrapT = THREE.ClampToEdgeWrapping;
  top.anisotropy = anisotropy;
  logo.wrapS = THREE.ClampToEdgeWrapping;
  logo.wrapT = THREE.ClampToEdgeWrapping;
  logo.anisotropy = anisotropy;

  const topBitmap = top.image;
  if (!(topBitmap instanceof ImageBitmap)) {
    throw new Error('board_top.jpg did not decode as ImageBitmap');
  }
  const pixels = bitmapRgba(topBitmap);
  const [r, g, b] = medianRgbFromRgba(pixels.data, pixels.width, pixels.height);
  const normalData = luminanceToNormalMap(pixels.data, pixels.width, pixels.height);
  const topNormal = dataTex(normalData, pixels.width, pixels.height, THREE.NoColorSpace);
  topNormal.wrapS = THREE.ClampToEdgeWrapping;
  topNormal.wrapT = THREE.ClampToEdgeWrapping;
  topNormal.anisotropy = anisotropy;

  let logoAspect = BOARD_LOGO_WIDTH_MM / Math.max(8, mm(BOARD_MM.height) * 0.55);
  const logoBitmap = logo.image;
  if (logoBitmap instanceof ImageBitmap) {
    const opaque = opaqueUvFromBitmap(logoBitmap);
    logoAspect = opaque.aspect;
  }

  return {
    top,
    topNormal,
    logo,
    logoAspect,
    median: new THREE.Color(r / 255, g / 255, b / 255),
  };
}

export function createCuttingBoard(
  maps: BoardMaps,
  opts: {
    anisotropy?: number;
    envMap?: THREE.Texture | null;
    quality?: RenderQuality;
  } = {},
): CuttingBoardBuild {
  const quality = opts.quality ?? DESKTOP_QUALITY;
  const anisotropy = opts.anisotropy ?? 1;
  const layout = kitchenLayout();
  const group = new THREE.Group();
  group.name = 'cuttingBoard';
  group.position.set(layout.board.x, layout.board.y, layout.board.z);
  group.rotation.y = BOARD_YAW_DEG * DEG;

  const size = quality.textureSize;
  const sideData = new Uint8Array(size * size * 4);
  const median = maps.median;
  fillLongGrainOak(sideData, size, 17, [
    Math.round(median.r * 255),
    Math.round(median.g * 255),
    Math.round(median.b * 255),
  ]);
  const sideMap = dataTex(sideData, size, size, THREE.SRGBColorSpace);
  sideMap.anisotropy = anisotropy;
  sideMap.wrapS = THREE.RepeatWrapping;
  sideMap.wrapT = THREE.RepeatWrapping;

  maps.top.anisotropy = Math.max(maps.top.anisotropy, anisotropy);
  maps.topNormal.anisotropy = Math.max(maps.topNormal.anisotropy, anisotropy);

  const sideMat = new THREE.MeshStandardMaterial({
    map: sideMap,
    roughness: 0.6,
    metalness: 0.02,
    envMap: opts.envMap ?? null,
    envMapIntensity: 0.4,
  });
  const bottomMat = sideMat.clone();
  const topMat = new THREE.MeshPhysicalMaterial({
    map: maps.top,
    normalMap: maps.topNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.55,
    metalness: 0,
    clearcoat: quality.clearcoat ? 0.15 : 0,
    clearcoatRoughness: 0.45,
    envMap: opts.envMap ?? null,
    envMapIntensity: 0.55,
  });

  const geo = new RoundedBoxGeometry(
    mm(BOARD_MM.length),
    mm(BOARD_MM.height),
    mm(BOARD_MM.width),
    4,
    mm(BOARD_EDGE_RADIUS_MM),
  );
  const body = new THREE.Mesh(geo, [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat]);
  body.name = 'cuttingBoardBody';
  body.castShadow = quality.shadows;
  body.receiveShadow = quality.shadows;
  group.add(body);

  const faceH = mm(BOARD_MM.height) * 0.7;
  const logoW = mm(BOARD_LOGO_WIDTH_MM);
  const logoH = Math.min(logoW / Math.max(0.2, maps.logoAspect), faceH);
  const logoGeo = new THREE.PlaneGeometry(logoW, logoH);
  const logoMat = new THREE.MeshStandardMaterial({
    map: maps.logo,
    transparent: true,
    alphaTest: 0.08,
    depthWrite: false,
    roughness: 0.55,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    envMap: opts.envMap ?? null,
    envMapIntensity: 0.3,
  });
  const logo = new THREE.Mesh(logoGeo, logoMat);
  logo.name = 'boardLogo';
  logo.castShadow = false;
  logo.receiveShadow = false;
  logo.renderOrder = 4;
  logo.position.set(0, 0, -(mm(BOARD_MM.width) / 2) - LOGO_LIFT_MM);
  logo.rotation.y = Math.PI;
  logo.scale.x = -1;
  group.add(logo);

  return { group, body, logo, maps: [sideMap, maps.top, maps.topNormal, maps.logo] };
}

export function disposeCuttingBoard(board: CuttingBoardBuild): void {
  const seen = new Set<THREE.Material>();
  board.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mat = obj.material;
      const list = Array.isArray(mat) ? mat : [mat];
      for (const m of list) {
        if (seen.has(m)) continue;
        seen.add(m);
        m.dispose();
      }
    }
  });
  board.maps.forEach((m) => m.dispose());
}
