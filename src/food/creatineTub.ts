/**
 * Authored KFD tub mesh. Label wrap is from product photos; Ø/H are
 * fly-readable millimetres, not the 500 g jar. Open in the live scene;
 * no lid mesh (eat stand is south of the tub). Not connectome data.
 */
import * as THREE from 'three';
import { CREATINE_ALBEDO_HEX, PILE_MM, TUB_MM, mm } from '../scene/scale.ts';
import { kitchenLayout } from '../scene/layout.ts';
import type { CreatineTextures } from '../scene/creatineTextures.ts';
import { pileHeightAt } from './powderPile.ts';

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
  applyMap(labelMat, textures?.labelWrap, { color: 0xffffff });

  // Cylinder UV: u=0 at +Z, u=0.5 at −Z. Group yaw −π/2 aims that front at +X (mill).
  // ImageBitmap upload leaves uv.y=0 at the JPEG bottom; invert V so KFD sits at the rim.
  const labelGeo = new THREE.CylinderGeometry(outerR, outerR, H, 64, 1, true);
  invertUvV(labelGeo);
  const outer = new THREE.Mesh(labelGeo, labelMat);
  outer.name = 'kfdLabel';
  outer.position.y = H / 2;
  outer.castShadow = true;
  outer.receiveShadow = true;
  group.add(outer);

  const innerGeo = new THREE.CylinderGeometry(innerR, innerR, H - floor, 48, 1, true);
  innerGeo.scale(-1, 1, 1);
  const innerWall = new THREE.Mesh(innerGeo, inner);
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
    roughness: 0.92,
    metalness: 0,
  });
  if (textures?.crumb) {
    const crumb = textures.crumb.clone();
    crumb.wrapS = THREE.RepeatWrapping;
    crumb.wrapT = THREE.RepeatWrapping;
    crumb.repeat.set(3, 2);
    crumb.needsUpdate = true;
    powderMat.map = crumb;
    if (textures.crumbNormal) {
      const n = textures.crumbNormal.clone();
      n.wrapS = THREE.RepeatWrapping;
      n.wrapT = THREE.RepeatWrapping;
      n.repeat.set(3, 2);
      n.needsUpdate = true;
      powderMat.normalMap = n;
    }
    if (textures.crumbRough) {
      const r = textures.crumbRough.clone();
      r.wrapS = THREE.RepeatWrapping;
      r.wrapT = THREE.RepeatWrapping;
      r.repeat.set(3, 2);
      r.needsUpdate = true;
      powderMat.roughnessMap = r;
    }
    powderMat.color.setHex(0xffffff);
  }
  const powderMound = new THREE.Mesh(
    powderMoundGeometry(mm(PILE_MM.radius), mm(PILE_MM.height)),
    powderMat,
  );
  powderMound.name = 'kfdPowderMound';
  powderMound.position.y = floor;
  powderMound.castShadow = true;
  powderMound.receiveShadow = true;
  group.add(powderMound);

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
