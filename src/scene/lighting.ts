/**
 * Authored kitchen lighting. Warm 3200 K key, cool fill, rim; table-only
 * PCF shadows. Not measured photometry.
 */
import * as THREE from 'three';
import type { RenderQuality } from './quality.ts';
import { EXPOSURE, kelvinToHex } from './proceduralMaps.ts';

export const FOG_COLOR = 0x07080c;
export const KEY_INTENSITY = 2.85;
export const FILL_INTENSITY = 0.48;
export const RIM_INTENSITY = 0.72;

export type KitchenLights = {
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
};

export function installKitchenLook(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  table: { width: number; depth: number },
  quality: RenderQuality,
): KitchenLights {
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 280, 920);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const hemi = new THREE.HemisphereLight(0xfff1dd, 0x12161c, 0.55);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(kelvinToHex(3200), KEY_INTENSITY);
  key.name = 'keyWarm';
  key.position.set(-140, 210, 80);
  key.castShadow = quality.shadows;
  const hw = table.width / 2 + 16;
  const hd = table.depth / 2 + 16;
  key.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 520;
  key.shadow.camera.left = -hw;
  key.shadow.camera.right = hw;
  key.shadow.camera.top = hd;
  key.shadow.camera.bottom = -hd;
  key.shadow.bias = -0.00045;
  key.shadow.normalBias = 0.4;
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.DirectionalLight(0xb8cce0, FILL_INTENSITY);
  fill.name = 'fillCool';
  fill.position.set(150, 70, 40);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xe8f0ff, RIM_INTENSITY);
  rim.name = 'rim';
  rim.position.set(10, 90, -170);
  scene.add(rim);

  return { hemi, key, fill, rim };
}
