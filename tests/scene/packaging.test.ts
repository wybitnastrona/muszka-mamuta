import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LABEL_IMAGE_H, LABEL_IMAGE_W, POUCH_MM, SEAL_MM } from '../../src/scene/scale.ts';
import { labelPlaneSize } from '../../src/scene/layout.ts';
import {
  dropFacesByNormal,
  pouchFilmGeometry,
  setPackLabelUVs,
} from '../../src/scene/Packaging.tsx';
import { opaqueUvRectFromRgba } from '../../src/scene/textures.ts';

describe('pouch film geometry', () => {
  it('is a 130×110×32 mm shell open on −X', () => {
    const open = pouchFilmGeometry(11);
    open.computeBoundingBox();
    const bb = open.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeGreaterThan(POUCH_MM.length - 8);
    expect(bb.max.z - bb.min.z).toBeGreaterThan(POUCH_MM.width - 8);
    expect(bb.max.y - bb.min.y).toBeGreaterThan(POUCH_MM.height - 4);
    expect(bb.max.y - bb.min.y).toBeLessThan(POUCH_MM.height + 5);
  });

  it('dropFacesByNormal removes only the matching side', () => {
    const geo = new THREE.BoxGeometry(10, 4, 8);
    const before = geo.getIndex()!.count;
    dropFacesByNormal(geo, new THREE.Vector3(-1, 0, 0), 0.9);
    expect(geo.getAttribute('position').count).toBe(before - 6);
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
