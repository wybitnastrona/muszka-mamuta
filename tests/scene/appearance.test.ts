import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CUTICLE_CLEARCOAT,
  CUTICLE_DARK,
  EYE_CLEARCOAT,
  createFlyMaterials,
} from '../../src/body/flyMaterials.ts';
import {
  coplanarShadowPairs,
  createKitchen,
  kitchenDrawCount,
  poseSpoon,
  shadowReceiverSurfaces,
} from '../../src/body/kitchen.ts';
import { createTreadmill } from '../../src/body/treadmill.ts';
import { createCreatineTub } from '../../src/food/creatineTub.ts';
import { frameForPreset, kitchenFrame, letterboxSize, reelFrame, usesShallowDof } from '../../src/body/cameras.ts';
import { CAMERA_PRESETS } from '../../src/body/types.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';
import {
  detectQuality,
  DESKTOP_QUALITY,
  MOBILE_QUALITY,
} from '../../src/scene/quality.ts';
import {
  CUTICLE_AMBER,
  EYE_RED,
  EXPOSURE,
  KEY_KELVIN,
  REEL_ELEV_DEG,
  REEL_FOV_DEG,
  TABLE_BEVEL_MM,
  TERGITE_BANDS,
  bristleOpaqueFraction,
  fillBristleAlpha,
  fillHexNormal,
  fillSimplexRoughness,
  kelvinToRgb,
} from '../../src/scene/proceduralMaps.ts';

const TINY = { ...DESKTOP_QUALITY, textureSize: 16 };

describe('render quality', () => {
  it('turns shadows and DOF off on coarse/narrow viewports', () => {
    expect(detectQuality({ width: 390, coarse: true })).toMatchObject({
      mobile: true,
      shadows: false,
      textureSize: 1024,
      dof: false,
    });
    expect(MOBILE_QUALITY.shadows).toBe(false);
    expect(DESKTOP_QUALITY.shadowMapSize).toBe(2048);
  });
});

describe('kitchen slab', () => {
  it('uses one beveled slab at y=0 as the standing deck (no coplanar plane)', () => {
    const kit = createKitchen(420, 340, TINY);
    expect(kit.group.getObjectByName('tableTop')).toBeUndefined();
    expect(kit.table.name).toBe('tableBulk');
    expect(kit.table).toBe(kit.group.getObjectByName('tableBulk'));
    expect(kit.table.geometry.type).toBe('ExtrudeGeometry');
    expect(kit.table.receiveShadow).toBe(true);
    expect(TABLE_BEVEL_MM).toBe(1);
    const deck = new THREE.Box3().setFromObject(kit.table);
    expect(deck.max.y).toBeLessThan(0.2);
    expect(deck.max.y).toBeGreaterThan(-0.05);
    expect(deck.min.y).toBeLessThan(-20);
    const tableMat = kit.table.material as THREE.MeshStandardMaterial;
    expect(tableMat.color.getHex()).toBe(0x3a6a8c);
    expect(tableMat.roughness).toBeCloseTo(0.85);
    expect(kit.group.getObjectByName('labFloor')).toBeTruthy();
    expect(kit.group.getObjectByName('darkGrid')).toBeFalsy();
    expect(kit.group.getObjectByName('cheesePlate')).toBeFalsy();
    expect(kit.group.getObjectByName('cuttingBoard')).toBeFalsy();
    expect(kit.group.getObjectByName('twarog')).toBeFalsy();
    expect(kit.spoon.name).toBe('scaleSpoon');
    expect(kit.spoon.visible).toBe(false);
    expect(kit.contactAo.name).toBe('thoraxContactAo');
    expect(kitchenDrawCount(kit.group)).toBeLessThan(14);
    poseSpoon(kit.spoon, 420, 340, 0);
    const restX = kit.spoon.position.x;
    poseSpoon(kit.spoon, 420, 340, 1);
    expect(kit.spoon.position.x).toBeLessThan(restX);
    kit.maps.forEach((m) => m.dispose());
    kit.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  });

  it('reports no two kitchen shadow receivers within 0.05 mm on the deck', () => {
    const kit = createKitchen(420, 340, TINY);
    const footprint = new THREE.Box3().setFromObject(kit.table);
    const surfaces = shadowReceiverSurfaces(kit.group, footprint);
    const atPlane = surfaces.filter((s) => s.minY <= 0.05 && s.maxY >= -0.05);
    const pairs = coplanarShadowPairs(surfaces, 0.05);
    const floor = surfaces.find((s) => s.name === 'labFloor');
    const bulk = surfaces.find((s) => s.name === 'tableBulk');
    console.log('kitchen shadow receivers', surfaces);
    console.log('at y=0 ±0.05', atPlane);
    console.log('coplanar pairs |ΔmaxY|<0.05', pairs);
    if (bulk && floor) console.log('tableBulk vs labFloor gap', Math.abs(bulk.maxY - floor.maxY));
    expect(atPlane.map((s) => s.name)).toEqual(['tableBulk']);
    expect(pairs).toEqual([]);
    expect(bulk).toBeTruthy();
    expect(Math.abs(bulk!.maxY)).toBeLessThan(0.05);
    expect(floor).toBeTruthy();
    expect(Math.abs(bulk!.maxY - floor!.maxY)).toBeGreaterThan(20);
    kit.maps.forEach((m) => m.dispose());
    kit.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  });

  it('prints mill/tub receivers near the deck without a second table plane', () => {
    const kit = createKitchen(420, 340, TINY);
    const root = new THREE.Group();
    root.add(kit.group);
    const mill = createTreadmill();
    root.add(mill.group);
    const tub = createCreatineTub(null);
    root.add(tub.group);
    const footprint = new THREE.Box3().setFromObject(kit.table);
    const surfaces = shadowReceiverSurfaces(root, footprint);
    const atPlane = surfaces.filter((s) => s.minY <= 0.05 && s.maxY >= -0.05);
    const pairs = coplanarShadowPairs(surfaces, 0.05);
    console.log('full-scene shadow receivers', surfaces);
    console.log('full-scene at y=0 ±0.05', atPlane);
    console.log('full-scene coplanar maxY pairs', pairs);
    expect(atPlane.some((s) => s.name === 'tableBulk')).toBe(true);
    expect(atPlane.some((s) => s.name === 'tableTop')).toBe(false);
    mill.dispose();
    tub.dispose();
    kit.maps.forEach((m) => m.dispose());
    kit.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  });
});

describe('Reel camera', () => {
  it('is a 9:16 studio frame at 35 mm / 15°, with DOF on the fly', () => {
    expect(CAMERA_PRESETS).toEqual(['Widok kuchni', 'Z boku', 'Zbliżenie', 'Etykieta', 'Przegląd', 'Reel']);
    const frame = reelFrame();
    expect(frame.fov).toBeCloseTo(REEL_FOV_DEG);
    const dx = frame.position[0] - frame.lookAt[0];
    const dy = frame.position[1] - frame.lookAt[1];
    const dz = frame.position[2] - frame.lookAt[2];
    const elev = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    expect(Math.abs(elev - REEL_ELEV_DEG)).toBeLessThan(0.6);
    const layout = kitchenLayout();
    expect(frame.lookAt[0]).toBeCloseTo((layout.fly.x + layout.pile.x) * 0.45);
    const kitchen = kitchenFrame(10);
    const kdx = kitchen.position[0] - kitchen.lookAt[0];
    const kdy = kitchen.position[1] - kitchen.lookAt[1];
    const kdz = kitchen.position[2] - kitchen.lookAt[2];
    const kitchenElev = (Math.atan2(kdy, Math.hypot(kdx, kdz)) * 180) / Math.PI;
    expect(kitchenElev).toBeGreaterThan(18);
    expect(kitchenElev).toBeLessThan(50);
    expect(kitchen.position[1]).toBeGreaterThan(80);
    expect(kitchen.position[2]).toBeLessThan(-200);
    expect(kitchen.lookAt[0]).toBeGreaterThan(layout.tub.x);
    expect(kitchen.lookAt[0]).toBeLessThan(layout.mill.x + layout.mill.hx + layout.mat.hx * 2);
    const kitchenDist = Math.hypot(kdx, kdy, kdz);
    const kitchenSpan = 2 * kitchenDist * Math.tan((kitchen.fov * Math.PI) / 360);
    expect(kitchenSpan).toBeGreaterThan(layout.tub.height * 0.7);
    expect(kitchen.position[2]).toBeLessThan(kitchen.lookAt[2]);
    expect(frameForPreset('Widok kuchni', 10)).toEqual(kitchenFrame(10));
    expect(frameForPreset('Reel', 10)).toEqual(reelFrame(10));
    const dist = Math.hypot(dx, dy, dz);
    expect(dist).toBeGreaterThan(500);
    expect(dist).toBeLessThan(900);
    expect(usesShallowDof('Zbliżenie')).toBe(true);
    expect(usesShallowDof('Reel')).toBe(true);
    expect(usesShallowDof('Widok kuchni')).toBe(false);
    expect(usesShallowDof('Przegląd')).toBe(false);
    const box = letterboxSize(1920, 1080);
    expect(box.width / box.height).toBeCloseTo(9 / 16, 5);
    expect(box.height).toBe(1080);
    expect(letterboxSize(1080, 1920)).toEqual({ width: 1080, height: 1920, x: 0, y: 0 });
  });
});

describe('fly materials', () => {
  it('uses MeshPhysicalMaterial with the authored cuticle and eye colours', () => {
    const kit = createFlyMaterials(TINY);
    const body = kit.materials.body as THREE.MeshPhysicalMaterial;
    const eye = kit.materials.red as THREE.MeshPhysicalMaterial;
    const wing = kit.materials.membrane as THREE.MeshPhysicalMaterial;
    const bristle = kit.materials['bristle-brown'] as THREE.MeshPhysicalMaterial;
    const ocelli = kit.materials.ocelli as THREE.MeshPhysicalMaterial;
    expect(body).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(body.color.getHexString()).toBe(CUTICLE_AMBER.slice(1));
    // Matte reel look: no lacquer, no amber sheen.
    expect(body.clearcoat).toBeCloseTo(CUTICLE_CLEARCOAT);
    expect(body.clearcoat).toBeLessThanOrEqual(0.15);
    expect(body.sheen).toBe(0);
    expect(body.roughness).toBeGreaterThanOrEqual(0.55);
    expect(body.envMapIntensity).toBeLessThanOrEqual(0.5);
    // Smooth deep-red eye: the hex facet map is gone (it gave ~2 × 6 cells per eye).
    expect(eye.color.getHexString()).toBe(EYE_RED.slice(1));
    expect(eye.normalMap).toBeNull();
    expect(eye.clearcoat).toBeCloseTo(EYE_CLEARCOAT);
    expect(eye.clearcoat).toBeLessThan(0.5);
    expect(eye.roughness).toBeGreaterThanOrEqual(0.4);
    // Antennae / mouthparts stay dark and matte.
    const dark = kit.materials.black as THREE.MeshPhysicalMaterial;
    expect(dark.color.getHexString()).toBe(CUTICLE_DARK.slice(1));
    expect(dark.sheen).toBe(0);
    expect(dark.clearcoat).toBe(0);
    expect(dark.roughness).toBeGreaterThanOrEqual(0.7);
    expect(wing.transmission).toBeCloseTo(0.9);
    expect(wing.iridescence).toBe(1);
    expect(wing.iridescenceThicknessRange[0]).toBe(100);
    expect(wing.iridescenceThicknessRange[1]).toBe(400);
    expect(bristle.alphaTest).toBeGreaterThan(0.4);
    const bristleMap = new Uint8Array(32 * 32 * 4);
    fillBristleAlpha(bristleMap, 32);
    expect(bristleOpaqueFraction(bristleMap, 32, bristle.alphaTest)).toBeLessThan(0.22);
    expect(ocelli.clearcoat).toBeLessThan(0.5);
    expect(TERGITE_BANDS).toBe(5);
    expect(EXPOSURE).toBeCloseTo(1.1);
    const [r, g, b] = kelvinToRgb(KEY_KELVIN);
    expect(r).toBe(255);
    expect(g).toBeGreaterThan(170);
    expect(b).toBeGreaterThan(90);
    expect(b).toBeLessThan(160);
    kit.setCropVolume(1);
    kit.maps.forEach((m) => m.dispose());
    Object.values(kit.materials).forEach((m) => m.dispose());
  });

  it('writes a hex normal map with facet tilt, not a flat +Z', () => {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    fillHexNormal(data, size, 8);
    let minB = 255;
    let maxB = 0;
    for (let i = 2; i < data.length; i += 4) {
      const b = data[i]!;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }
    expect(maxB).toBeGreaterThan(200);
    expect(minB).toBeLessThan(maxB);
    const rough = new Uint8Array(8 * 8 * 4);
    fillSimplexRoughness(rough, 8, 1);
    expect(rough[0]).toBeGreaterThan(0);
  });
});
