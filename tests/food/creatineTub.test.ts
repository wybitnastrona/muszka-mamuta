import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCreatineTub } from '../../src/food/creatineTub.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';
import { PILE_MM, TUB_MM, POWDER_STACK_FRAC, mm, tubInnerRadiusMm, tubRadiusMm } from '../../src/scene/scale.ts';
import { parseCreatineManifest, LABEL_WRAP_FLIP_Y } from '../../src/scene/creatineTextures.ts';
import { tubLabelFrame } from '../../src/body/cameras.ts';

describe('KFD tub layout', () => {
  it('nests the powder fill inside the well without a table lid', () => {
    const layout = kitchenLayout();
    expect(layout.tub.diameter).toBe(mm(TUB_MM.diameter));
    expect(layout.tub.height).toBe(mm(TUB_MM.height));
    expect(layout.tub.innerRadius).toBe(tubInnerRadiusMm());
    expect(PILE_MM.radius).toBeLessThan(tubInnerRadiusMm());
    expect(layout.pile.x).toBe(layout.tub.x);
    expect(layout.pile.z).toBe(layout.tub.z);
    expect(layout.pile.y).toBeCloseTo(mm(TUB_MM.wall) + mm(PILE_MM.height) / 2);
    expect(PILE_MM.height).toBeCloseTo(TUB_MM.height / 3);
    expect(layout.tub.yaw).toBeCloseTo(-Math.PI / 2);
    expect(layout.scoop.x).toBe(layout.tub.x);
    expect(layout.scoop.z).toBe(layout.tub.z);
  });

  it('uses the measured 142 mm tub with a one-third powder fill', () => {
    expect(TUB_MM.height).toBe(142);
    expect(TUB_MM.diameter).toBe(110);
    expect(PILE_MM.height).toBeCloseTo(TUB_MM.height / 3);
    expect(PILE_MM.radius).toBeLessThan(tubInnerRadiusMm());
    expect(TUB_MM.diameter / TUB_MM.height).toBeCloseTo(110 / 142, 5);
  });

  it('builds a labelled cylinder with a 3D powder mound, not a photo disc', () => {
    const layout = kitchenLayout();
    const tub = createCreatineTub();
    expect(tub.group.name).toBe('kfdTub');
    expect(tub.group.getObjectByName('kfdLabel')).toBeTruthy();
    expect(tub.group.getObjectByName('kfdLid')).toBeFalsy();
    expect(tub.group.getObjectByName('kfdPowderMound')).toBeTruthy();
    expect(tub.group.getObjectByName('kfdPowderStack')).toBeTruthy();
    expect(tub.group.getObjectByName('kfdPowderStackBase')).toBeTruthy();
    expect(tub.group.getObjectByName('kfdPowderDisc')).toBeFalsy();
    expect(tub.powderMound.geometry.type).toBe('LatheGeometry');
    expect(tub.powderMound.position.y).toBeCloseTo(mm(TUB_MM.wall) + mm(PILE_MM.height) * POWDER_STACK_FRAC);
    expect(tub.labelAnchor.position.z).toBeLessThan(0);
    expect(Math.abs(tub.labelAnchor.position.z)).toBeCloseTo(tubRadiusMm());
    tub.group.updateMatrixWorld(true);
    const world = tub.labelAnchor.getWorldPosition(new THREE.Vector3());
    expect(world.x).toBeGreaterThan(layout.tub.x);
    expect(Math.abs(world.z - layout.tub.z)).toBeLessThan(2);
    tub.dispose();
  });

  it('parses the creatine texture manifest keys', () => {
    const man = parseCreatineManifest({
      label_wrap: 'creatine/label_wrap.jpg',
      lid_top: 'creatine/lid_top.png',
      lid_underside: 'creatine/lid_underside.png',
      well: 'creatine/well.png',
      bottom: 'creatine/bottom.png',
      creatine_crumb: 'creatine/creatine_crumb.png',
      creatine_crumb_normal: 'creatine/creatine_crumb_normal.png',
      creatine_crumb_rough: 'creatine/creatine_crumb_rough.png',
      creatine_median_hex: '#e6e2d8',
    });
    expect(man.label_wrap).toContain('label_wrap');
    expect(LABEL_WRAP_FLIP_Y).toBe(false);
    const frame = tubLabelFrame();
    const layout = kitchenLayout();
    expect(frame.lookAt[0]).toBeGreaterThan(layout.tub.x);
    expect(frame.position[0]).toBeGreaterThan(frame.lookAt[0]);
    const dist = Math.hypot(
      frame.position[0] - frame.lookAt[0],
      frame.position[1] - frame.lookAt[1],
      frame.position[2] - frame.lookAt[2],
    );
    const vSpan = 2 * dist * Math.tan((frame.fov * Math.PI) / 360);
    expect(vSpan).toBeGreaterThan(layout.tub.height * 0.85);
    expect(frame.fov).toBeLessThan(40);
  });
});
