/**
 * Authored fly-scale creatine scoop. Mesh is procedural (two product photos
 * are not a photogrammetry capture). White PP and optional KFD stamp match
 * IMG_8523 / 8524. A real scoop is 50–80 mm.
 */
import * as THREE from 'three';
import { CREATINE_ALBEDO_HEX, SCOOP_MM, TUB_MM, mm } from '../scene/scale.ts';
import { kitchenLayout } from '../scene/layout.ts';
import type { ScoopMode } from '../food/creatineSystem.ts';

export const SCOOP_PICK_S = 0.75;
export const SCOOP_DIP_S = 1.15;
export const SCOOP_DROP_S = 0.65;

export type ScoopHandle = {
  group: THREE.Group;
  powder: THREE.Mesh;
  update(args: {
    mode: ScoopMode;
    fill: number;
    dipU?: number;
    table: { x: number; y: number; z: number; yaw: number };
    dropped: { x: number; y: number; z: number; yaw: number };
    gripWorld: THREE.Matrix4 | null;
    heading?: number;
  }): void;
  dispose(): void;
};

/** Bowl centre in scoop-local mm (grip at origin, +Z along the handle). */
export function scoopBowlLocal(): { x: number; y: number; z: number } {
  return { x: 0, y: mm(SCOOP_MM.bowlDepth) * 0.15, z: mm(SCOOP_MM.handleLength) * 0.55 };
}

function kfdStampMap(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f3efe8';
  ctx.fillRect(0, 0, 128, 48);
  ctx.fillStyle = '#1c1c1c';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('KFD', 64, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createScoop(): ScoopHandle {
  const group = new THREE.Group();
  group.name = 'creatineScoop';
  const plastic = new THREE.MeshPhysicalMaterial({
    color: 0xf3efe8,
    roughness: 0.48,
    metalness: 0.02,
    envMapIntensity: 0.3,
  });
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(mm(SCOOP_MM.handleRadius), mm(SCOOP_MM.handleRadius) * 1.15, mm(SCOOP_MM.handleLength), 10),
    plastic,
  );
  handle.rotation.x = Math.PI / 2;
  handle.position.z = mm(SCOOP_MM.handleLength) * 0.35;
  handle.castShadow = true;
  group.add(handle);
  const stampMap = kfdStampMap();
  if (stampMap) {
    const stamp = new THREE.Mesh(
      new THREE.PlaneGeometry(mm(4.2), mm(1.6)),
      new THREE.MeshBasicMaterial({ map: stampMap, transparent: true }),
    );
    stamp.position.set(0, mm(SCOOP_MM.handleRadius) + 0.15, mm(SCOOP_MM.handleLength) * 0.28);
    stamp.rotation.x = -Math.PI / 2;
    group.add(stamp);
  }
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(
      mm(SCOOP_MM.bowlRadius),
      mm(SCOOP_MM.bowlRadius) * 0.92,
      mm(SCOOP_MM.bowlDepth),
      18,
      1,
      true,
    ),
    plastic,
  );
  const bowlLocal = scoopBowlLocal();
  bowl.position.set(bowlLocal.x, bowlLocal.y, bowlLocal.z);
  bowl.castShadow = true;
  group.add(bowl);
  const bowlFloor = new THREE.Mesh(
    new THREE.CircleGeometry(mm(SCOOP_MM.bowlRadius) * 0.92, 18),
    plastic,
  );
  bowlFloor.rotation.x = Math.PI / 2;
  bowlFloor.position.set(bowlLocal.x, bowlLocal.y - mm(SCOOP_MM.bowlDepth) * 0.5, bowlLocal.z);
  group.add(bowlFloor);
  const powder = new THREE.Mesh(
    new THREE.CylinderGeometry(mm(SCOOP_MM.bowlRadius) * 0.72, mm(SCOOP_MM.bowlRadius) * 0.72, 1.2, 12),
    new THREE.MeshStandardMaterial({ color: CREATINE_ALBEDO_HEX, roughness: 0.92 }),
  );
  powder.position.set(bowlLocal.x, bowlLocal.y, bowlLocal.z);
  powder.name = 'scoopPowder';
  group.add(powder);

  const tmp = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  return {
    group,
    powder,
    update({ mode, fill, dipU = 0, table, dropped, gripWorld }) {
      powder.visible = fill > 0.04;
      powder.scale.set(1, Math.max(0.08, fill), 1);
      if (mode === 'held' && gripWorld) {
        gripWorld.decompose(tmp, quat, scale);
        group.position.copy(tmp);
        group.quaternion.copy(quat);
        group.rotateX(-0.55);
        group.rotateY(0.15);
        if (dipU > 0) {
          const well = kitchenLayout().pile;
          const dx = well.x - group.position.x;
          const dz = well.z - group.position.z;
          group.position.x += dx * 0.42 * dipU;
          group.position.z += dz * 0.42 * dipU;
          group.position.y += mm(TUB_MM.height) * 0.55 * dipU;
        }
        group.visible = true;
        return;
      }
      const pose = mode === 'dropped' ? dropped : table;
      group.position.set(pose.x, pose.y, pose.z);
      // Well and dropped: lie on the powder / table, not a planted stick.
      group.rotation.set(mode === 'well' ? -1.22 : -1.18, pose.yaw, 0.08);
      group.visible = true;
    },
    dispose() {
      stampMap?.dispose();
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
