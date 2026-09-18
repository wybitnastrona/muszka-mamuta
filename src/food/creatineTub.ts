/**
 * Authored KFD tub mesh. Label wrap is from product photos; Ø/H are
 * fly-readable millimetres, not the 500 g jar. Open in the live scene;
 * eat stand is inside the well. Not connectome data.
 */
import * as THREE from 'three';
import {
  CREATINE_ALBEDO_HEX,
  PILE_MM,
  TUB_MM,
  mm,
  powderMoundHeightMm,
  powderStackHeightMm,
} from '../scene/scale.ts';
import { kitchenLayout } from '../scene/layout.ts';
import type { CreatineTextures } from '../scene/creatineTextures.ts';
import { pileHeightAt } from './powderPile.ts';

/** Packshot wrap JPEGs are 4:1; the cylinder UV is ~2.43:1. */
const WRAP_ASPECT_FALLBACK = 4;

export type CreatineTubHandle = {
  group: THREE.Group;
  labelAnchor: THREE.Object3D;
  powderMound: THREE.Mesh;
  dispose(): void;
};

function plastic(color: number, roughness = 0.38): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0.04,
    envMapIntensity: 0.45,
  });
}

function applyMap(
  mat: THREE.MeshPhysicalMaterial,
  map: THREE.Texture | undefined,
  opts: { alpha?: boolean; color?: number } = {},
): void {
  if (!map) return;
  mat.map = map;
  if (opts.color !== undefined) mat.color.setHex(opts.color);
  if (opts.alpha) {
    mat.transparent = true;
    mat.alphaTest = 0.35;
  }
}

function invertUvV(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (uv.getY(i) as number));
  uv.needsUpdate = true;
}

function wrapImageAspect(map: THREE.Texture | undefined): number {
  const img = map?.image as { width?: number; height?: number } | undefined;
  if (img?.width && img?.height) return img.width / img.height;
  return WRAP_ASPECT_FALLBACK;
}

/**
 * Cylinder UV is 1×1 around 2πr × H. A wider wrap JPEG would squeeze glyphs
 * on U. Scale U about 0.5 and ClampToEdge so PREMIUM CREATINE keeps aspect.
 */
function unsqueezeWrapUv(
  geometry: THREE.BufferGeometry,
  radius: number,
  height: number,
  imageAspect: number,
): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  const cylAspect = (2 * Math.PI * radius) / Math.max(1e-6, height);
  const uScale = Math.min(1, cylAspect / Math.max(1e-6, imageAspect));
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) as number;
    uv.setX(i, 0.5 + (u - 0.5) * uScale);
  }
  uv.needsUpdate = true;
}

function applyLabelWrap(mat: THREE.MeshPhysicalMaterial, map: THREE.Texture | undefined): void {
  if (!map) return;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.repeat.set(1, 1);
  map.offset.set(0, 0);
  map.needsUpdate = true;
  mat.map = map;
  mat.color.setHex(0xffffff);
}

function powderMoundGeometry(radius: number, height: number, segs = 24): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= segs; i++) {
    const r = (i / segs) * radius;
    pts.push(new THREE.Vector2(r, pileHeightAt(r, 0, radius, height)));
  }
  return new THREE.LatheGeometry(pts, 48);
}

export function createCreatineTub(textures?: CreatineTextures | null): CreatineTubHandle {
  const layout = kitchenLayout();
  const group = new THREE.Group();
  group.name = 'kfdTub';
  group.position.set(layout.tub.x, 0, layout.tub.z);
  group.rotation.y = layout.tub.yaw;

  const outerR = mm(TUB_MM.diameter) / 2;
  const innerR = outerR - mm(TUB_MM.wall);
  const H = mm(TUB_MM.height);
  const floor = mm(TUB_MM.wall);
  const black = plastic(0x151515, 0.6);
  const bottomMat = plastic(0x151515, 0.6);
  const inner = plastic(0x151515, 0.62);
  const labelMat = plastic(0x151515, 0.6);
  applyLabelWrap(labelMat, textures?.labelWrap);

  // Cylinder UV: u=0 at +Z, u=0.5 at −Z. Group yaw −π/2 aims that front at +X (mill).
  // ImageBitmap upload leaves uv.y=0 at the JPEG bottom; invert V so KFD sits at the rim.
  const labelGeo = new THREE.CylinderGeometry(outerR, outerR, H, 64, 1, true);
  invertUvV(labelGeo);
  unsqueezeWrapUv(labelGeo, outerR, H, wrapImageAspect(textures?.labelWrap));
  const outer = new THREE.Mesh(labelGeo, labelMat);
  outer.name = 'kfdLabel';
  outer.position.y = H / 2;
  outer.castShadow = true;
  outer.receiveShadow = true;
  group.add(outer);

  const innerGeo = new THREE.CylinderGeometry(innerR, innerR, H - floor, 48, 1, true);
  innerGeo.scale(-1, 1, 1);
  const innerWall = new THREE.Mesh(innerGeo, inner);
  innerWall.name = 'kfdInnerWall';
  innerWall.position.y = floor + (H - floor) / 2;
  group.add(innerWall);

  const floorMesh = new THREE.Mesh(new THREE.CircleGeometry(innerR, 48), black);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = floor;
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  applyMap(bottomMat, textures?.bottom, { alpha: true });
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(outerR, 48), bottomMat);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = 0.05;
  group.add(bottom);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(outerR - mm(TUB_MM.wall) * 0.45, mm(TUB_MM.wall) * 0.45, 8, 48),
    black,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = H - 0.4;
  rim.castShadow = true;
  group.add(rim);

  const powderMat = new THREE.MeshStandardMaterial({
    color: CREATINE_ALBEDO_HEX,
    roughness: 0.95,
    metalness: 0,
    map: null,
    normalScale: new THREE.Vector2(0.35, 0.35),
  });
  const detail = textures?.crumbNormal ?? textures?.crumb;
  if (detail) {
    const n = detail.clone();
    n.wrapS = THREE.RepeatWrapping;
    n.wrapT = THREE.RepeatWrapping;
    n.repeat.set(3, 2);
    n.needsUpdate = true;
    if (textures?.crumbNormal) powderMat.normalMap = n;
    else {
      powderMat.bumpMap = n;
      powderMat.bumpScale = 0.35;
    }
  }
  if (textures?.crumbRough) {
    const r = textures.crumbRough.clone();
    r.wrapS = THREE.RepeatWrapping;
    r.wrapT = THREE.RepeatWrapping;
    r.repeat.set(3, 2);
    r.needsUpdate = true;
    powderMat.roughnessMap = r;
  } else if (textures?.crumb && !powderMat.bumpMap) {
    const r = textures.crumb.clone();
    r.wrapS = THREE.RepeatWrapping;
    r.wrapT = THREE.RepeatWrapping;
    r.repeat.set(3, 2);
    r.needsUpdate = true;
    powderMat.roughnessMap = r;
  }
  const stackH = powderStackHeightMm();
  const moundH = powderMoundHeightMm();
  const stackR = innerR * 0.98;
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(stackR, stackR, stackH, 48),
    powderMat,
  );
  stack.name = 'kfdPowderStack';
  stack.position.y = floor + stackH / 2;
  stack.castShadow = true;
  stack.receiveShadow = true;
  group.add(stack);

  const stackBase = new THREE.Mesh(
    new THREE.CircleGeometry(stackR, 48),
    powderMat,
  );
  stackBase.name = 'kfdPowderStackBase';
  stackBase.rotation.x = -Math.PI / 2;
  stackBase.position.y = floor + stackH + 0.15;
  stackBase.receiveShadow = true;
  group.add(stackBase);

  const powderMound = new THREE.Mesh(
    powderMoundGeometry(mm(PILE_MM.radius), moundH),
    powderMat,
  );
  powderMound.name = 'kfdPowderMound';
  powderMound.position.y = floor + stackH;
  powderMound.castShadow = true;
  powderMound.receiveShadow = true;
  group.add(powderMound);

  const linerH = Math.max(0.5, H - (floor + stackH));
  const liner = new THREE.Group();
  liner.name = 'kfdWellLiner';
  const bandGeo = new THREE.CylinderGeometry(innerR, innerR, linerH, 48, 1, true);
  bandGeo.scale(-1, 1, 1);
  const band = new THREE.Mesh(bandGeo, inner);
  band.position.y = floor + stackH + linerH / 2;
  liner.add(band);
  const collar = new THREE.Mesh(new THREE.RingGeometry(stackR, innerR, 64), inner);
  collar.rotation.x = -Math.PI / 2;
  collar.position.y = floor + stackH + 0.22;
  liner.add(collar);
  group.add(liner);

  const labelAnchor = new THREE.Object3D();
  labelAnchor.name = 'kfdLabelAnchor';
  // Cylinder UV u=0.5 is local −Z (front). World +X after kitchenLayout().tub.yaw.
  labelAnchor.position.set(0, H * 0.72, -outerR);
  group.add(labelAnchor);

  return {
    group,
    labelAnchor,
    powderMound,
    dispose() {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    },
  };
}
