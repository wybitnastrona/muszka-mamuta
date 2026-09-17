import * as THREE from 'three';
import { asset } from '../lib/atlas.ts';

export const TEXTURE_KEYS = [
  'pack_front',
  'pack_back',
  'twarog_crumb',
  'twarog_crumb_normal',
  'twarog_crumb_rough',
] as const;

export type TextureKey = (typeof TEXTURE_KEYS)[number];

export type TextureManifest = Record<TextureKey, string> & {
  curd_median_hex?: string;
};

export type UvRect = {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  aspect: number;
};

export type KitchenTextures = {
  manifest: TextureManifest;
  packFront: THREE.Texture;
  packBack: THREE.Texture;
  packFrontUv: UvRect;
  packBackUv: UvRect;
  crumb: THREE.Texture;
  crumbNormal: THREE.Texture;
  crumbRough: THREE.Texture;
};

/** Image-space UV bounds of non-transparent pixels (y=0 at the top of the file). */
export function opaqueUvRectFromRgba(
  data: ArrayLike<number>,
  width: number,
  height: number,
  alphaMin = 8,
): UvRect {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > alphaMin) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) {
    return { u0: 0, v0: 0, u1: 1, v1: 1, aspect: width / Math.max(1, height) };
  }
  const ow = maxX - minX + 1;
  const oh = maxY - minY + 1;
  return {
    u0: minX / width,
    v0: minY / height,
    u1: (maxX + 1) / width,
    v1: (maxY + 1) / height,
    aspect: ow / oh,
  };
}

function pixelContext(width: number, height: number): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) return ctx;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) return ctx;
  }
  throw new Error('Cannot read kitchen texture pixels');
}

export function bitmapRgba(bitmap: ImageBitmap): ImageData {
  const ctx = pixelContext(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

export function opaqueUvFromBitmap(bitmap: ImageBitmap): UvRect {
  const img = bitmapRgba(bitmap);
  return opaqueUvRectFromRgba(img.data, bitmap.width, bitmap.height);
}

export function parseTextureManifest(json: unknown): TextureManifest {
  if (!json || typeof json !== 'object') {
    throw new Error('textures.json is missing or not an object');
  }
  const rec = json as Record<string, unknown>;
  const out = {} as TextureManifest;
  for (const key of TEXTURE_KEYS) {
    const value = rec[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`textures.json is missing "${key}"`);
    }
    out[key] = value;
  }
  if (typeof rec.curd_median_hex === 'string') out.curd_median_hex = rec.curd_median_hex;
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
    throw new Error(`Missing kitchen texture ${label} (${path}): HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

export async function loadKitchenTextures(signal?: AbortSignal): Promise<KitchenTextures> {
  const manifestUrl = asset('textures/textures.json');
  const response = await fetch(manifestUrl, { signal });
  if (!response.ok) {
    throw new Error(`Missing textures.json: HTTP ${response.status}`);
  }
  const manifest = parseTextureManifest(await response.json());
  const [packFront, packBack, crumb, crumbNormal, crumbRough] = await Promise.all([
    loadImageTexture(manifest.pack_front, 'pack_front', THREE.SRGBColorSpace, signal),
    loadImageTexture(manifest.pack_back, 'pack_back', THREE.SRGBColorSpace, signal),
    loadImageTexture(manifest.twarog_crumb, 'twarog_crumb', THREE.SRGBColorSpace, signal),
    loadImageTexture(manifest.twarog_crumb_normal, 'twarog_crumb_normal', THREE.NoColorSpace, signal),
    loadImageTexture(manifest.twarog_crumb_rough, 'twarog_crumb_rough', THREE.NoColorSpace, signal),
  ]);
  const packFrontBitmap = packFront.image;
  const packBackBitmap = packBack.image;
  if (!(packFrontBitmap instanceof ImageBitmap) || !(packBackBitmap instanceof ImageBitmap)) {
    throw new Error('Kitchen pack textures did not decode as ImageBitmap');
  }
  return {
    manifest,
    packFront,
    packBack,
    packFrontUv: opaqueUvFromBitmap(packFrontBitmap),
    packBackUv: opaqueUvFromBitmap(packBackBitmap),
    crumb,
    crumbNormal,
    crumbRough,
  };
}

export function disposeKitchenTextures(textures: KitchenTextures): void {
  textures.packFront.dispose();
  textures.packBack.dispose();
  textures.crumb.dispose();
  textures.crumbNormal.dispose();
  textures.crumbRough.dispose();
}
