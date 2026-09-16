import * as THREE from 'three';
import type { BoneAnchor, BoneName } from './types.ts';
import { BONE_NAMES } from './types.ts';
import { ANCHORS, type FlybodyMeta } from './hierarchy.ts';
import { computeSkinWeights, mixBoneColor } from './skinWeights.ts';
import { BONE_PALETTE, BONE_COLORS } from './palette.ts';
import type { Pose } from './types.ts';

export { ANCHORS, describeFlybodyHierarchy, type FlybodyMeta, type HierarchyReport } from './hierarchy.ts';

export type BuiltRig = {
  root: THREE.Group;
  armature: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: Map<BoneName, THREE.Bone>;
  boneList: THREE.Bone[];
  skinned: THREE.SkinnedMesh[];
  contact: THREE.Object3D;
};

export function boneIndex(name: BoneName): number {
  return BONE_NAMES.indexOf(name);
}

export function buildSkeleton(anchorList: readonly BoneAnchor[] = ANCHORS.bones): {
  armature: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: Map<BoneName, THREE.Bone>;
  boneList: THREE.Bone[];
} {
  const byName = new Map<BoneName, BoneAnchor>();
  for (const a of anchorList) byName.set(a.name, a);
  const bones = new Map<BoneName, THREE.Bone>();
  const boneList: THREE.Bone[] = [];
  for (const name of BONE_NAMES) {
    const bone = new THREE.Bone();
    bone.name = name;
    bones.set(name, bone);
    boneList.push(bone);
  }
  const world = new Map<BoneName, THREE.Vector3>();
  for (const name of BONE_NAMES) {
    const a = byName.get(name);
    world.set(name, new THREE.Vector3(...(a?.position ?? [0, 0, 0])));
  }
  const armature = new THREE.Group();
  armature.name = 'armature';
  for (const name of BONE_NAMES) {
    const a = byName.get(name);
    const bone = bones.get(name)!;
    const parentName = a?.parent ?? null;
    const pos = world.get(name)!;
    if (parentName && bones.has(parentName)) {
      const parent = bones.get(parentName)!;
      const ppos = world.get(parentName)!;
      bone.position.copy(pos).sub(ppos);
      parent.add(bone);
    } else {
      bone.position.copy(pos);
      armature.add(bone);
    }
  }
  const skeleton = new THREE.Skeleton(boneList);
  skeleton.calculateInverses();
  return { armature, skeleton, bones, boneList };
}

export function applyPoseToBones(bones: Map<BoneName, THREE.Bone>, pose: Pose): void {
  for (const name of BONE_NAMES) {
    const bone = bones.get(name);
    if (!bone) continue;
    const q = pose[name].rotation;
    bone.quaternion.set(q[0], q[1], q[2], q[3]);
  }
}

function colorGeometry(
  geometry: THREE.BufferGeometry,
  skinIndex: Uint16Array,
  skinWeight: Float32Array,
): void {
  const n = (geometry.getAttribute('position') as THREE.BufferAttribute).count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = mixBoneColor(skinIndex, skinWeight, i, BONE_PALETTE);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function buildFlybodyRig(
  meta: FlybodyMeta,
  buffer: ArrayBuffer,
  materials: Record<string, THREE.Material>,
  opts: { debugWeights?: boolean } = {},
): BuiltRig {
  const { armature, skeleton, bones, boneList } = buildSkeleton();
  const root = new THREE.Group();
  root.name = 'flybody';
  root.add(armature);

  const skinned: THREE.SkinnedMesh[] = [];
  const debug = !!opts.debugWeights;
  const byName = new Map(ANCHORS.bones.map((b) => [b.name, b]));

  for (const part of meta.parts) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array(buffer.slice(part.positionByteOffset, part.positionByteOffset + part.positionCount * 12)),
        3,
      ),
    );
    geometry.setIndex(
      new THREE.BufferAttribute(
        new Uint32Array(buffer.slice(part.indexByteOffset, part.indexByteOffset + part.indexCount * 4)),
        1,
      ),
    );
    geometry.computeVertexNormals();

    const pivot = meta.pivots[part.group] ?? [0, 0, 0];
    const baseMat = materials[part.material] ?? materials.body;
    const material = debug
      ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
      : (baseMat as THREE.Material).clone();

    const legBone = ANCHORS.bones.find((b) => b.legGroup === part.group);
    if (legBone) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${part.group}:${part.material}`;
      const parent = bones.get(legBone.name);
      if (parent) parent.add(mesh);
      else {
        mesh.position.fromArray(pivot);
        root.add(mesh);
      }
      if (debug) {
        const c = BONE_COLORS[legBone.name];
        const n = part.positionCount;
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          colors[i * 3] = c[0];
          colors[i * 3 + 1] = c[1];
          colors[i * 3 + 2] = c[2];
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      continue;
    }

    const worldPos = new Float32Array(part.positionCount * 3);
    const src = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < part.positionCount; i++) {
      worldPos[i * 3] = src.getX(i) + pivot[0];
      worldPos[i * 3 + 1] = src.getY(i) + pivot[1];
      worldPos[i * 3 + 2] = src.getZ(i) + pivot[2];
    }
    const { skinIndex, skinWeight } = computeSkinWeights(worldPos, ANCHORS.bones, {
      material: part.material,
    });
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    if (debug) colorGeometry(geometry, skinIndex, skinWeight);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `${part.group}:${part.material}`;
    mesh.frustumCulled = false;
    mesh.bind(skeleton);
    root.add(mesh);
    skinned.push(mesh);
  }

  const contact = new THREE.Object3D();
  contact.name = 'labellumContact';
  bones.get('haustellum')?.add(contact);
  const h = byName.get('haustellum')!.position;
  const l = byName.get('labellum_L')!.position;
  const r = byName.get('labellum_R')!.position;
  contact.position.set((l[0] + r[0]) / 2 - h[0], (l[1] + r[1]) / 2 - h[1], (l[2] + r[2]) / 2 - h[2]);

  return { root, armature, skeleton, bones, boneList, skinned, contact };
}
