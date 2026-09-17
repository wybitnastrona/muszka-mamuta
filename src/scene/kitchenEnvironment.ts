/**
 * Blurred kitchen equirect from IMG_8478–8484. Used as scene.environment so
 * the compound eyes and PET film reflect the real room. The hero still is
 * not loaded — match-move compositing was abandoned (docs/SCENE-COMPOSITE.md).
 */
import * as THREE from 'three';
import { asset } from '../lib/atlas.ts';

export const KITCHEN_ENV_URL = 'textures/kitchen/env_512.jpg';
export const KITCHEN_ENV_INTENSITY = 0.5;

export async function loadKitchenEnvironment(
  pmrem: THREE.PMREMGenerator,
  signal?: AbortSignal,
): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader();
  const tex = await loader.loadAsync(asset(KITCHEN_ENV_URL));
  if (signal?.aborted) {
    tex.dispose();
    throw new DOMException('aborted', 'AbortError');
  }
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
  return env;
}
