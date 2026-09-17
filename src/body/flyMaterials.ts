/**
 * Authored MeshPhysicalMaterial kit for Flybody parts. Colour and coats are
 * not measured; MaleCNS does not describe cuticle BRDF.
 *
 * Look target is the flat, matte reel fly (the viral template render):
 * smooth deep-red eyes, matte amber chitin, dark antennae and mouthparts.
 * The earlier glossy kit (clearcoat 1 eyes with a hex facet normal map,
 * amber sheen on every part, envMap 0.85–1.1) turned each eye into a mirror
 * ball — the spherical UV is computed about the model origin, so only ~2 × 6
 * hex cells landed on an eye — and made antennae and the proboscis read as
 * polished amber horns. See docs/BODY-MODEL.md § Appearance.
 */
import * as THREE from 'three';
import type { RenderQuality } from '../scene/quality.ts';
import { DESKTOP_QUALITY } from '../scene/quality.ts';
import {
  CUTICLE_AMBER,
  CUTICLE_LEG,
  EYE_RED,
  OCELLUS,
  TERGITE_BANDS,
  fillBristleAlpha,
  fillSimplexRoughness,
} from '../scene/proceduralMaps.ts';

export type FlyMaterialKit = {
  materials: Record<string, THREE.Material>;
  maps: THREE.Texture[];
  setCropVolume: (value: number) => void;
};

/** Matte chitin: the reel look, not lacquer. */
export const CUTICLE_ROUGHNESS = 0.6;
export const CUTICLE_CLEARCOAT = 0.12;
export const CUTICLE_ENV = 0.4;
/** Antennae / palps / mouthpart segments (Flybody part `black`). */
export const CUTICLE_DARK = '#2a1a10';
export const DARK_ROUGHNESS = 0.72;
/** Compound eye: smooth, deep red, soft highlight. */
export const EYE_ROUGHNESS = 0.45;
export const EYE_CLEARCOAT = 0.2;
export const EYE_ENV = 0.35;

function dataTex(
  data: Uint8Array,
  size: number,
  colorSpace: THREE.ColorSpace,
  wrap: THREE.Wrapping,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = colorSpace;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function attachTergites(mat: THREE.MeshPhysicalMaterial, cropRef: { value: number }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCrop = cropRef;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float abdomenMask;
attribute float restZ;
varying float vAbdomen;
varying float vRestZ;`,
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
vAbdomen = abdomenMask;
vRestZ = restZ;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uCrop;
varying float vAbdomen;
varying float vRestZ;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float phase = clamp((vRestZ + 0.20) / 0.14, 0.0, 1.0);
  float stripe = smoothstep(0.36, 0.48, abs(fract(phase * ${TERGITE_BANDS.toFixed(1)}) - 0.5));
  vec3 abdomenCol = vec3(0.541, 0.290, 0.110);
  diffuseColor.rgb = mix(diffuseColor.rgb, abdomenCol, vAbdomen * 0.72);
  diffuseColor.rgb *= 1.0 - vAbdomen * stripe * 0.42;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
  float fres = pow(1.0 - clamp(ndv, 0.0, 1.0), 2.4);
  totalEmissiveRadiance += vec3(0.92, 0.55, 0.20) * fres * vAbdomen * (0.16 + 0.75 * uCrop);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'cuticle-tergites-v1';
}

function attachWingVeins(mat: THREE.MeshPhysicalMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
#ifdef USE_UV
{
  float v1 = abs(sin(vUv.x * 28.0));
  float v2 = abs(sin(vUv.y * 9.0 + vUv.x * 3.0));
  float vein = 1.0 - smoothstep(0.045, 0.12, min(v1, v2));
  diffuseColor.rgb *= 1.0 - 0.38 * vein;
  diffuseColor.a *= 1.0 - 0.12 * vein;
}
#endif`,
    );
  };
  mat.customProgramCacheKey = () => 'wing-veins-v1';
}

export function createFlyMaterials(quality: RenderQuality = DESKTOP_QUALITY): FlyMaterialKit {
  const size = quality.textureSize;
  const cropRef = { value: 0 };
  const maps: THREE.Texture[] = [];

  const roughData = new Uint8Array(size * size * 4);
  fillSimplexRoughness(roughData, size, 17, 140, 48);
  const roughnessMap = dataTex(roughData, size, THREE.NoColorSpace, THREE.RepeatWrapping);
  maps.push(roughnessMap);

  const bristleData = new Uint8Array(size * size * 4);
  fillBristleAlpha(bristleData, size);
  const bristleAlpha = dataTex(bristleData, size, THREE.NoColorSpace, THREE.ClampToEdgeWrapping);
  maps.push(bristleAlpha);

  const coat = quality.clearcoat ? CUTICLE_CLEARCOAT : 0;
  const irid = quality.iridescence ? 1 : 0;

  const cuticle = (
    color: string,
    opts: { tergites?: boolean; dark?: boolean } = {},
  ): THREE.MeshPhysicalMaterial => {
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: opts.dark ? DARK_ROUGHNESS : CUTICLE_ROUGHNESS,
      roughnessMap: opts.dark ? null : roughnessMap,
      metalness: 0.02,
      clearcoat: opts.dark ? 0 : coat,
      clearcoatRoughness: 0.5,
      sheen: 0,
      envMapIntensity: opts.dark ? 0.2 : CUTICLE_ENV,
    });
    if (opts.tergites) attachTergites(mat, cropRef);
    return mat;
  };

  const materials: Record<string, THREE.Material> = {
    body: cuticle(CUTICLE_AMBER, { tergites: true }),
    brown: cuticle('#8a4a1c'),
    // Antennae, palps and proboscis segments: really dark, no amber sheen.
    black: cuticle(CUTICLE_DARK, { dark: true }),
    lower: cuticle(CUTICLE_LEG),
    // Compound eye: one smooth deep-red dome with a soft highlight. No facet
    // normal map — the eye's spherical UV about the model origin spans only
    // 0.067 × 0.204, i.e. ~2 × 6 hex cells per eye, which read as beads.
    red: new THREE.MeshPhysicalMaterial({
      color: EYE_RED,
      roughness: EYE_ROUGHNESS,
      metalness: 0,
      clearcoat: EYE_CLEARCOAT,
      clearcoatRoughness: 0.4,
      envMapIntensity: EYE_ENV,
    }),
    ocelli: new THREE.MeshPhysicalMaterial({
      color: OCELLUS,
      roughness: 0.3,
      metalness: 0.05,
      clearcoat: 0.3,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.4,
    }),
    'bristle-brown': new THREE.MeshPhysicalMaterial({
      color: '#281c10',
      roughness: 0.78,
      metalness: 0,
      transparent: true,
      alphaMap: bristleAlpha,
      alphaTest: 0.48,
      depthWrite: true,
      side: THREE.FrontSide,
    }),
  };

  const membrane = new THREE.MeshPhysicalMaterial({
    color: 0xc5d4e2,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.9,
    thickness: 0.02,
    ior: 1.45,
    iridescence: irid,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 400],
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    envMapIntensity: 1,
  });
  attachWingVeins(membrane);
  materials.membrane = membrane;

  return {
    materials,
    maps,
    setCropVolume: (value) => {
      cropRef.value = value;
    },
  };
}

export function ensurePlanarUv(geometry: THREE.BufferGeometry, scale = 48): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * scale;
    uv[i * 2 + 1] = pos.getZ(i) * scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Shaft UV for hanging legs: U around the limb, V along Y so cuticle is not an XZ smear. */
export function ensureShaftUv(geometry: THREE.BufferGeometry, scale = 22): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    uv[i * 2] = Math.atan2(x, z) / Math.PI;
    uv[i * 2 + 1] = y * scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Bristle cards: U around the thorax, V along the hair so alpha shafts stay thin. */
export function ensureBristleUv(geometry: THREE.BufferGeometry, scale = 28): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    uv[i * 2] = (Math.atan2(x, z) / Math.PI) * 6;
    uv[i * 2 + 1] = y * scale + z * scale * 0.35;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function ensureSphericalUv(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, y, z) || 1;
    uv[i * 2] = 0.5 + Math.atan2(x, z) / (Math.PI * 2);
    uv[i * 2 + 1] = 0.5 + Math.asin(Math.max(-1, Math.min(1, y / r))) / Math.PI;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function ensureWingUv(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * 14 + 0.5;
    uv[i * 2 + 1] = pos.getZ(i) * 10 + 0.5;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function thinEveryOtherTriangle(geometry: THREE.BufferGeometry): void {
  const idx = geometry.getIndex();
  if (!idx || idx.count < 1800) return;
  const src = idx.array;
  const out: number[] = [];
  for (let t = 0; t + 2 < src.length; t += 6) {
    out.push(src[t]!, src[t + 1]!, src[t + 2]!);
  }
  geometry.setIndex(out);
}

export function setAbdomenAttributes(
  geometry: THREE.BufferGeometry,
  skinIndex: Uint16Array,
  skinWeight: Float32Array,
  worldPos: Float32Array,
  abdomenBone: number,
): void {
  const n = worldPos.length / 3;
  const mask = new Float32Array(n);
  const restZ = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    restZ[i] = worldPos[i * 3 + 2]!;
    let w = 0;
    for (let k = 0; k < 4; k++) {
      if (skinIndex[i * 4 + k] === abdomenBone) w = skinWeight[i * 4 + k]!;
    }
    mask[i] = w;
  }
  geometry.setAttribute('abdomenMask', new THREE.BufferAttribute(mask, 1));
  geometry.setAttribute('restZ', new THREE.BufferAttribute(restZ, 1));
}
