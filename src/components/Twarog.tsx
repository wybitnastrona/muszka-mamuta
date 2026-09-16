import { useEffect } from 'react';
import * as THREE from 'three';
import { t, type Lang } from '../i18n.ts';
import { CAPTION_EN } from '../hud/captions.ts';
import type { ProceduralTwarog } from '../food/proceduralTwarog.ts';
import type { ConsumeEvent, TwarogSystem } from '../food/twarogSystem.ts';
import { REFILL_ANIM_S } from '../food/twarogSystem.ts';
import { CURD_ALBEDO_HEX, CURD_MM, mm } from '../scene/scale.ts';
import { Xoshiro128ss } from '../brain/rng.ts';

const CRUMB_POOL = 64;
const TABLE_CRUMB_COUNT = 12;
const GRAVITY = 420;

type Crumb = {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  settled: boolean;
};

export type TwarogView = {
  group: THREE.Group;
  update(dt: number, system: TwarogSystem): void;
  spawnCrumbs(event: ConsumeEvent): void;
  resetCrumbs(): void;
  dispose(): void;
};

export function createTwarogView(proc: ProceduralTwarog): TwarogView {
  const group = proc.group;
  const dummy = new THREE.Object3D();
  const crumbMat = new THREE.MeshStandardMaterial({
    color: CURD_ALBEDO_HEX,
    roughness: 0.85,
    metalness: 0,
  });
  const crumbsMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1.2, 1.4), crumbMat, CRUMB_POOL);
  crumbsMesh.name = 'twarogCrumbs';
  crumbsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crumbsMesh.castShadow = true;
  crumbsMesh.frustumCulled = false;
  dummy.scale.set(0, 0, 0);
  dummy.updateMatrix();
  for (let i = 0; i < CRUMB_POOL; i++) crumbsMesh.setMatrixAt(i, dummy.matrix);
  crumbsMesh.instanceMatrix.needsUpdate = true;
  group.add(crumbsMesh);
  const biteWorld = new THREE.Vector3();
  const lodMat = proc.lodBlock.material as THREE.MeshStandardMaterial;

  const crumbs: Crumb[] = Array.from({ length: CRUMB_POOL }, () => ({
    active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, settled: false,
  }));
  let crumbCursor = 0;
  const tableY = -group.position.y + 0.7;

  const seedTableCrumbs = () => {
    const rng = new Xoshiro128ss(11);
    const hx = mm(CURD_MM.width) / 2;
    const hz = mm(CURD_MM.length) / 2;
    for (let i = 0; i < TABLE_CRUMB_COUNT; i++) {
      const slot = crumbs[i]!;
      const ang = rng.nextFloat() * Math.PI * 2;
      const rad = Math.max(hx, hz) + 5 + rng.nextFloat() * 11;
      slot.active = true;
      slot.settled = true;
      slot.x = Math.cos(ang) * rad;
      slot.y = tableY;
      slot.z = Math.sin(ang) * rad;
      slot.vx = 0;
      slot.vy = 0;
      slot.vz = 0;
    }
    crumbCursor = TABLE_CRUMB_COUNT;
  };

  const spawnCrumbs = (event: ConsumeEvent) => {
    const c = event.centroid;
    for (let n = 0; n < event.crumbCount; n++) {
      const slot = crumbs[crumbCursor]!;
      crumbCursor = (crumbCursor + 1) % CRUMB_POOL;
      const a = (n / event.crumbCount) * Math.PI * 2 + event.index * 0.17;
      slot.active = true;
      slot.settled = false;
      slot.x = c.x;
      slot.y = c.y + 1.2;
      slot.z = c.z;
      slot.vx = Math.cos(a) * (8 + (event.index % 5));
      slot.vy = 14 + (n % 3) * 4;
      slot.vz = Math.sin(a) * (8 + (event.index % 4));
    }
  };

  const updateCrumbs = (dt: number) => {
    dummy.rotation.set(0, 0, 0);
    for (let i = 0; i < CRUMB_POOL; i++) {
      const p = crumbs[i]!;
      if (!p.active) {
        dummy.position.set(0, -40, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        crumbsMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      if (!p.settled) {
        p.vy -= GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vx *= 0.98;
        p.vz *= 0.98;
        if (p.y <= tableY) {
          p.y = tableY;
          p.vy *= -0.18;
          p.vx *= 0.55;
          p.vz *= 0.55;
          if (Math.abs(p.vy) < 12) {
            p.vy = 0;
            p.settled = true;
          }
        }
      }
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.y = i * 0.7;
      dummy.updateMatrix();
      crumbsMesh.setMatrixAt(i, dummy.matrix);
    }
    crumbsMesh.instanceMatrix.needsUpdate = true;
  };

  const update = (dt: number, system: TwarogSystem) => {
    const lod = system.lodBlend;
    const refillFade = system.refilling
      ? Math.max(0, 1 - system.refillT / Math.max(0.001, REFILL_ANIM_S * 0.45))
      : 1;
    const appear = system.appearT;
    const chunkAlpha = lod * refillFade * appear;
    const blockAlpha = (1 - lod) * refillFade * appear;
    proc.lodBlock.visible = blockAlpha > 0.02;
    lodMat.opacity = blockAlpha;
    lodMat.depthWrite = blockAlpha > 0.55;
    proc.lodBlock.castShadow = blockAlpha > 0.5;
    proc.exterior.opacity = chunkAlpha;
    proc.exterior.depthWrite = chunkAlpha > 0.55;
    proc.interior.opacity = chunkAlpha;
    proc.wetInterior.opacity = chunkAlpha;

    for (let i = 0; i < proc.chunks.length; i++) {
      const rec = system.chunks[i]!;
      const mesh = proc.chunks[i]!.mesh;
      const scale = system.scaleOf(i);
      if (rec.eaten || scale <= 0.02 || chunkAlpha < 0.02) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      const c = rec.centroid;
      mesh.position.set(c.x * (1 - scale), c.y * (1 - scale), c.z * (1 - scale));
      mesh.scale.setScalar(scale);
      const exposed = system.isExposed(i);
      mesh.material = exposed ? [proc.wetInterior, proc.wetInterior] : [proc.exterior, proc.interior];
    }

    biteWorld.set(system.lastBiteFront.x, system.lastBiteFront.y, system.lastBiteFront.z);
    proc.group.localToWorld(biteWorld);
    proc.biteUniforms.uBiteFront.value.copy(biteWorld);
    proc.biteUniforms.uBiteWet.value = system.uneatenCount < system.chunkCount ? 1 : 0;

    updateCrumbs(dt);
  };

  const resetCrumbs = () => {
    for (const p of crumbs) p.active = false;
    seedTableCrumbs();
    updateCrumbs(0);
  };

  seedTableCrumbs();
  updateCrumbs(0);

  return {
    group,
    update,
    spawnCrumbs,
    resetCrumbs,
    dispose: () => {
      crumbsMesh.geometry.dispose();
      crumbMat.dispose();
    },
  };
}

export { CAPTION_EN };

export function TwarogHud({
  lang,
  toast,
  portions,
  caption,
}: {
  lang: Lang;
  toast: boolean;
  portions: number;
  caption?: string;
}) {
  const shown = caption ? (lang === 'en' ? (CAPTION_EN[caption] ?? caption) : caption) : '';
  return (
    <>
      <div className="twarog-portions" aria-live="polite">
        {t(lang, 'portionCount', { n: String(portions) })}
      </div>
      {shown && (
        <div className="fly-caption" aria-live="polite">{shown}</div>
      )}
      {toast && (
        <div className="twarog-toast" role="status">{t(lang, 'freshPortion')}</div>
      )}
    </>
  );
}

export function useToast(visible: boolean, onHide: () => void, ms = 2400): void {
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(onHide, ms);
    return () => window.clearTimeout(id);
  }, [visible, onHide, ms]);
}
