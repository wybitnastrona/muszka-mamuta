import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  LABEL_IMAGE_H,
  LABEL_IMAGE_W,
  POUCH_BASE_HEIGHT_MM,
  POUCH_DEPTH_SEGMENTS,
  POUCH_MM,
  POUCH_WIDTH_SEGMENTS,
  SEAL_MM,
} from '../../src/scene/scale.ts';
import { labelPlaneSize } from '../../src/scene/layout.ts';
import {
  createPackaging,
  filmMaterial,
  pouchFilmGeometry,
  setPackLabelUVs,
} from '../../src/scene/Packaging.tsx';
import { opaqueUvRectFromRgba, type KitchenTextures, type UvRect } from '../../src/scene/textures.ts';

function stubTextures(rect: UvRect = { u0: 0.1, v0: 0.2, u1: 0.9, v1: 0.8, aspect: 0.71 }): KitchenTextures {
  const packFront = new THREE.Texture();
  packFront.flipY = true;
  const packBack = new THREE.Texture();
  packBack.flipY = true;
  const dummy = new THREE.Texture();
  return {
    manifest: {
      pack_front: 'pack_front.png',
      pack_back: 'pack_back.png',
      twarog_crumb: 'twarog_crumb.png',
      twarog_crumb_normal: 'twarog_crumb_normal.png',
      twarog_crumb_rough: 'twarog_crumb_rough.png',
    },
    packFront,
    packBack,
    packFrontUv: rect,
    packBackUv: rect,
    crumb: dummy,
    crumbNormal: dummy,
    crumbRough: dummy,
  };
}

describe('pouch film geometry', () => {
  it('is a 40×32 limp film, ~130×110 mm, collapsed to millimetres not 32 mm', () => {
    const geo = pouchFilmGeometry(11);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    expect(pos.count).toBe((POUCH_WIDTH_SEGMENTS + 1) * (POUCH_DEPTH_SEGMENTS + 1));
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeGreaterThan(POUCH_MM.length * 0.72);
    expect(bb.max.z - bb.min.z).toBeGreaterThan(POUCH_MM.width * 0.72);
    expect(bb.max.y).toBeGreaterThan(4);
    expect(bb.max.y).toBeLessThan(22);
    expect(bb.min.y).toBeGreaterThanOrEqual(0);
    expect(bb.max.y - bb.min.y).toBeLessThan(22);
    expect(bb.max.y - bb.min.y).toBeLessThan(POUCH_MM.height - 8);

    const ys: number[] = [];
    for (let i = 0; i < pos.count; i++) ys.push(pos.getY(i));
    ys.sort((a, b) => a - b);
    const p90 = ys[Math.floor(ys.length * 0.9)]!;
    expect(p90).toBeLessThan(10);
    expect(p90).toBeGreaterThan(POUCH_BASE_HEIGHT_MM * 0.25);

    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    let ny = 0;
    for (let i = 0; i < nrm.count; i++) ny += nrm.getY(i);
    expect(ny / nrm.count).toBeGreaterThan(0.35);
  });

  it('varies vertex height so the surface is not a rigid box', () => {
    const pos = pouchFilmGeometry(11).getAttribute('position') as THREE.BufferAttribute;
    const unique = new Set<string>();
    for (let i = 0; i < pos.count; i++) unique.add(pos.getY(i).toFixed(2));
    expect(unique.size).toBeGreaterThan(40);
  });
});

describe('pack label UVs', () => {
  it('maps photograph U along +X and V along +Y inside the opaque rect', () => {
    const geo = new THREE.PlaneGeometry(100, 70);
    const rect = { u0: 0.1, v0: 0.2, u1: 0.9, v1: 0.8, aspect: 1 };
    setPackLabelUVs(geo, rect, { flipY: true, mirrorU: false });
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(rect.u0 - 1e-6);
      expect(uv.getX(i)).toBeLessThanOrEqual(rect.u1 + 1e-6);
      const v = uv.getY(i);
      const lo = Math.min(1 - rect.v0, 1 - rect.v1);
      const hi = Math.max(1 - rect.v0, 1 - rect.v1);
      expect(v).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(v).toBeLessThanOrEqual(hi + 1e-6);
    }
  });

  it('keeps contained print UVs inside the opaque rect and [0, 1]', () => {
    const rect = { u0: 0.1, v0: 0.2, u1: 0.9, v1: 0.8, aspect: 0.71 };
    const pack = createPackaging(stubTextures(rect), { anisotropy: 8, seed: 11 });
    const uv = pack.labelFront.geometry.getAttribute('uv') as THREE.BufferAttribute;
    let printed = 0;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const transparent = u === 0 && v === 0;
      if (!transparent) {
        printed += 1;
        expect(u).toBeGreaterThanOrEqual(rect.u0 - 1e-5);
        expect(u).toBeLessThanOrEqual(rect.u1 + 1e-5);
        const lo = Math.min(1 - rect.v0, 1 - rect.v1);
        const hi = Math.max(1 - rect.v0, 1 - rect.v1);
        expect(v).toBeGreaterThanOrEqual(lo - 1e-5);
        expect(v).toBeLessThanOrEqual(hi + 1e-5);
      }
    }
    expect(printed).toBeGreaterThan(80);
    const labPos = pack.labelFront.geometry.getAttribute('position') as THREE.BufferAttribute;
    const filmPos = (pack.group.getObjectByName('pouchFilm') as THREE.Mesh)
      .geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(labPos.count).toBe(filmPos.count);
    expect(labPos.getY(0)).toBeCloseTo(filmPos.getY(0), 5);
    expect(labPos.getY(Math.floor(labPos.count / 2)))
      .toBeCloseTo(filmPos.getY(Math.floor(filmPos.count / 2)), 5);
  });
});

describe('createPackaging film', () => {
  it('uses thin crumpled PET and maps the label onto the deformed film', () => {
    const pack = createPackaging(stubTextures(), { anisotropy: 16, seed: 11 });
    const film = pack.group.getObjectByName('pouchFilm') as THREE.Mesh;
    const mat = film.material as THREE.MeshPhysicalMaterial;
    expect(mat.roughness).toBeCloseTo(0.25);
    expect(mat.transmission).toBeCloseTo(0.9);
    expect(mat.thickness).toBeCloseTo(0.15);
    expect(mat.ior).toBeCloseTo(1.5);
    expect(mat.side).toBe(THREE.FrontSide);
    expect(mat.roughnessMap).toBeTruthy();
    expect((mat.roughnessMap as THREE.Texture).anisotropy).toBe(16);
    expect(pack.labelFront.name).toBe('packLabelFront');
    expect(pack.labelBack.name).toBe('packLabelBack');
    expect(filmMaterial().thickness).toBeCloseTo(0.15);
  });
});

describe('opaque UV crop', () => {
  it('ignores fully transparent letterbox pixels', () => {
    const w = 8;
    const h = 12;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 3; y <= 8; y++) {
      for (let x = 1; x <= 6; x++) {
        const i = (y * w + x) * 4;
        data[i] = 200;
        data[i + 3] = 255;
      }
    }
    const rect = opaqueUvRectFromRgba(data, w, h);
    expect(rect.u0).toBeCloseTo(1 / 8, 5);
    expect(rect.u1).toBeCloseTo(7 / 8, 5);
    expect(rect.v0).toBeCloseTo(3 / 12, 5);
    expect(rect.v1).toBeCloseTo(9 / 12, 5);
    expect(rect.aspect).toBeCloseTo(6 / 6, 5);
  });
});

describe('pack label plane', () => {
  it('preserves photograph aspect fitted to the 130×110 mm face', () => {
    const file = labelPlaneSize();
    expect(file.length / file.width).toBeCloseTo(LABEL_IMAGE_W / LABEL_IMAGE_H, 5);
    const opaque = labelPlaneSize(1024 / 1438);
    expect(opaque.length / opaque.width).toBeCloseTo(1024 / 1438, 5);
    expect(opaque.length).toBeLessThanOrEqual(POUCH_MM.length);
    expect(opaque.width).toBeLessThanOrEqual(POUCH_MM.width);
    expect(POUCH_MM.length).toBe(100 + 2 * SEAL_MM);
  });
});
