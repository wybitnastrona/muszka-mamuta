/**
 * Authored KFD tub mesh. Label wrap is from product photos; Ø/H are
 * fly-readable millimetres, not the 500 g jar. Open in the live scene;
 * the lid sits beside it. Not connectome data.
 */
import * as THREE from 'three';
import { CREATINE_ALBEDO_HEX, PILE_MM, TUB_MM, mm } from '../scene/scale.ts';
import { kitchenLayout } from '../scene/layout.ts';
import type { CreatineTextures } from '../scene/creatineTextures.ts';

export type CreatineTubHandle = {
  group: THREE.Group;
  labelAnchor: THREE.Object3D;
  powderDisc: THREE.Mesh;
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
  const black = plastic(0x121212, 0.42);
  const bottomMat = plastic(0x121212, 0.45);
  const inner = plastic(0x2a2a2c, 0.55);
  const labelMat = plastic(0x1a1a1a, 0.48);
  applyMap(labelMat, textures?.labelWrap, { color: 0xffffff });

  // Cylinder UV: u=0 at +Z, u=0.5 at −Z (kitchen camera / wrap front).
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(outerR, outerR, H, 64, 1, true),
    labelMat,
  );
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
    powderMat.map = textures.crumb;
    powderMat.normalMap = textures.crumbNormal;
    powderMat.roughnessMap = textures.crumbRough;
    powderMat.color.setHex(0xffffff);
  }
  const powderDisc = new THREE.Mesh(
    new THREE.CircleGeometry(mm(PILE_MM.radius), 48),
    powderMat,
  );
  powderDisc.name = 'kfdPowderDisc';
  powderDisc.rotation.x = -Math.PI / 2;
  powderDisc.position.y = mm(PILE_MM.height);
  powderDisc.receiveShadow = true;
  group.add(powderDisc);

  const labelAnchor = new THREE.Object3D();
  labelAnchor.name = 'kfdLabelAnchor';
  // Cylinder UV u=0.75 is −Z (front, toward the kitchen camera).
  labelAnchor.position.set(0, H * 0.55, -outerR);
  group.add(labelAnchor);

  const lid = new THREE.Group();
  lid.name = 'kfdLid';
  lid.position.set(layout.lid.x - layout.tub.x, 0, layout.lid.z - layout.tub.z);
  lid.rotation.y = layout.lid.yaw;
  const lidR = mm(TUB_MM.lidDiameter) / 2;
  const lidH = mm(TUB_MM.lidHeight);
  const lidSide = plastic(0x0e0e0e, 0.32);
  const lidTopMat = plastic(0x0a0a0a, 0.28);
  const lidUnderMat = plastic(0xd4cbb8, 0.7);
  applyMap(lidTopMat, textures?.lidTop, { alpha: true, color: 0xffffff });
  applyMap(lidUnderMat, textures?.lidUnderside, { alpha: true, color: 0xffffff });
  const lidBody = new THREE.Mesh(new THREE.CylinderGeometry(lidR, lidR, lidH, 48), lidSide);
  lidBody.position.y = lidH / 2;
  lidBody.castShadow = true;
  lid.add(lidBody);
  const lidTop = new THREE.Mesh(new THREE.CircleGeometry(lidR * 0.98, 48), lidTopMat);
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.y = lidH + 0.05;
  lid.add(lidTop);
  const lidUnder = new THREE.Mesh(new THREE.CircleGeometry(lidR * 0.92, 48), lidUnderMat);
  lidUnder.rotation.x = Math.PI / 2;
  lidUnder.position.y = 0.08;
  lid.add(lidUnder);
  group.add(lid);

  return {
    group,
    labelAnchor,
    powderDisc,
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
