import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { createFlyMaterials, type FlyMaterialKit } from '../body/flyMaterials.ts';
import { installKitchenLook } from '../scene/lighting.ts';
import { detectQuality, type RenderQuality } from '../scene/quality.ts';
import { kitchenLayout } from '../scene/layout.ts';

export type FlyViewport = {
  scene: THREE.Scene;
  world: THREE.Group;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  envMap: THREE.Texture;
  pmrem: THREE.PMREMGenerator;
  materials: Record<string, THREE.Material>;
  quality: RenderQuality;
  kit: FlyMaterialKit;
  setCropVolume: (value: number) => void;
  setDof: (opts: {
    enabled: boolean;
    focus: number;
    aperture: number;
    maxblur: number;
  }) => void;
  setPixelSize: (size: { width: number; height: number } | null) => void;
  resize: () => void;
  draw: () => void;
  dispose: () => void;
};

export { createFlyMaterials };

export function createFlyViewport(
  element: HTMLElement,
  quality: RenderQuality = detectQuality(),
): FlyViewport {
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.08, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  element.append(renderer.domElement);
  const layout = kitchenLayout();
  installKitchenLook(scene, renderer, layout.table, quality);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.maxDistance = 600;
  controls.minDistance = 8;
  const kit = createFlyMaterials(quality);
  const materials = kit.materials;

  let composer: EffectComposer | null = null;
  let bokeh: BokehPass | null = null;
  let dofOn = false;
  if (quality.dof) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bokeh = new BokehPass(scene, camera, {
      focus: 40,
      aperture: 0.00022,
      maxblur: 0.012,
    });
    composer.addPass(bokeh);
  }

  let lockedSize: { width: number; height: number } | null = null;

  const resize = () => {
    const { width, height } = element.getBoundingClientRect();
    const w = Math.max(1, lockedSize?.width ?? width);
    const h = Math.max(1, lockedSize?.height ?? height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    composer?.setSize(w, h);
  };

  const setPixelSize = (size: { width: number; height: number } | null) => {
    lockedSize = size;
    resize();
  };

  const setDof = (opts: {
    enabled: boolean;
    focus: number;
    aperture: number;
    maxblur: number;
  }) => {
    dofOn = opts.enabled && quality.dof;
    if (!bokeh) return;
    const u = bokeh.uniforms as Record<string, { value: number }>;
    u.focus!.value = opts.focus;
    u.aperture!.value = opts.aperture;
    u.maxblur!.value = opts.maxblur;
  };

  const dispose = () => {
    controls.dispose();
    world.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const mat = object.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
    Object.values(materials).forEach((m) => m.dispose());
    kit.maps.forEach((m) => m.dispose());
    envMap.dispose();
    pmrem.dispose();
    composer?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };

  return {
    scene,
    world,
    camera,
    renderer,
    controls,
    envMap,
    pmrem,
    materials,
    quality,
    kit,
    setCropVolume: kit.setCropVolume,
    setDof,
    setPixelSize,
    resize,
    draw: () => {
      if (dofOn && composer) composer.render();
      else renderer.render(scene, camera);
    },
    dispose,
  };
}
