import * as THREE from 'three';
import { asset } from '../lib/atlas.ts';

export const CREATINE_TEXTURE_KEYS = [
  'label_wrap',
  'lid_top',
  'lid_underside',
  'well',
  'bottom',
  'creatine_crumb',
  'creatine_crumb_normal',
  'creatine_crumb_rough',
] as const;

export type CreatineTextureKey = (typeof CREATINE_TEXTURE_KEYS)[number];

export type CreatineTextureManifest = Record<CreatineTextureKey, string> & {
  creatine_median_hex?: string;
};

export const LABEL_WRAP_FLIP_Y = false;

export type CreatineTextures = {
  manifest: CreatineTextureManifest;
  labelWrap: THREE.Texture;
  lidTop: THREE.Texture;
  lidUnderside: THREE.Texture;
  well: THREE.Texture;
  bottom: THREE.Texture;
  crumb: THREE.Texture;
  crumbNormal: THREE.Texture;
  crumbRough: THREE.Texture;
};

export function parseCreatineManifest(json: unknown): CreatineTextureManifest {
  if (!json || typeof json !== 'object') {
    throw new Error('creatine/textures.json is missing or not an object');
  }
  const rec = json as Record<string, unknown>;
  const out = {} as CreatineTextureManifest;
  for (const key of CREATINE_TEXTURE_KEYS) {
    const value = rec[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`creatine/textures.json is missing "${key}"`);
    }
    out[key] = value;
  }
  if (typeof rec.creatine_median_hex === 'string') out.creatine_median_hex = rec.creatine_median_hex;
  return out;
}

async function loadImageTexture(
  path: string,
  label: string,
  colorSpace: THREE.ColorSpace,
  signal?: AbortSignal,
): Promise<THREE.Texture> {
  const url = asset(`textures/${path}`);
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Missing creatine texture ${label} (${path}): HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

export async function loadCreatineTextures(signal?: AbortSignal): Promise<CreatineTextures> {
  const manifestUrl = asset('textures/creatine/textures.json');
  const response = await fetch(manifestUrl, { signal });
  if (!response.ok) {
    throw new Error(`Missing creatine/textures.json: HTTP ${response.status}`);
  }
  const manifest = parseCreatineManifest(await response.json());
  const [labelWrap, lidTop, lidUnderside, well, bottom, crumb, crumbNormal, crumbRough] = await Promise.all([
    loadImageTexture(manifest.label_wrap, 'label_wrap', THREE.SRGBColorSpace, signal),
    loadImageTexture(manifest.lid_top, 'lid_top', THREE.SRGBColorSpace, signal),
    loadImageTexture(manifest.lid_underside, 'lid_underside', THREE.SRGBColorSpace, signal),
    loadImageTexture(manifest.well, 'well', THREE.SRGBColorSpace, signal),
    loadImageTexture(manifest.bottom, 'bottom', THREE.SRGBColorSpace, signal),
    loadImageTexture(manifest.creatine_crumb, 'creatine_crumb', THREE.SRGBColorSpace, signal),
    loadImageTexture(manifest.creatine_crumb_normal, 'creatine_crumb_normal', THREE.NoColorSpace, signal),
    loadImageTexture(manifest.creatine_crumb_rough, 'creatine_crumb_rough', THREE.NoColorSpace, signal),
  ]);
  labelWrap.wrapS = THREE.RepeatWrapping;
  labelWrap.wrapT = THREE.ClampToEdgeWrapping;
  labelWrap.anisotropy = 8;
  // CylinderGeometry uses uv.y = 1 − v; keep JPEG top at the rim (KFD above PREMIUM).
  labelWrap.flipY = LABEL_WRAP_FLIP_Y;
  crumb.wrapS = THREE.RepeatWrapping;
  crumb.wrapT = THREE.RepeatWrapping;
  crumbNormal.wrapS = THREE.RepeatWrapping;
  crumbNormal.wrapT = THREE.RepeatWrapping;
  crumbRough.wrapS = THREE.RepeatWrapping;
  crumbRough.wrapT = THREE.RepeatWrapping;
  return {
    manifest,
    labelWrap,
    lidTop,
    lidUnderside,
    well,
    bottom,
    crumb,
    crumbNormal,
    crumbRough,
  };
}

export function disposeCreatineTextures(textures: CreatineTextures): void {
  textures.labelWrap.dispose();
  textures.lidTop.dispose();
  textures.lidUnderside.dispose();
  textures.well.dispose();
  textures.bottom.dispose();
  textures.crumb.dispose();
  textures.crumbNormal.dispose();
  textures.crumbRough.dispose();
}
