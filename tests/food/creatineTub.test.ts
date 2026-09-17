import { describe, expect, it } from 'vitest';
import { createCreatineTub } from '../../src/food/creatineTub.ts';
import { kitchenLayout } from '../../src/scene/layout.ts';
import {
  PILE_MM,
  TUB_MM,
  flyVisualLengthMm,
  mm,
  tubInnerRadiusMm,
  tubRadiusMm,
} from '../../src/scene/scale.ts';
import { parseCreatineManifest } from '../../src/scene/creatineTextures.ts';
import { tubLabelFrame } from '../../src/body/cameras.ts';

describe('KFD tub layout', () => {
  it('nests the powder fill inside the well and parks the lid beside it', () => {
    const layout = kitchenLayout();
    expect(layout.tub.diameter).toBe(mm(TUB_MM.diameter));
    expect(layout.tub.height).toBe(mm(TUB_MM.height));
    expect(layout.tub.innerRadius).toBe(tubInnerRadiusMm());
    expect(PILE_MM.radius).toBeLessThan(tubInnerRadiusMm());
    expect(layout.pile.x).toBe(layout.tub.x);
    expect(layout.pile.z).toBe(layout.tub.z);
    expect(layout.pile.y).toBeCloseTo(mm(PILE_MM.height) / 2);
    expect(layout.lid.x).toBeLessThan(layout.tub.x - tubRadiusMm());
    const lidGap = (layout.tub.x - tubRadiusMm()) - (layout.lid.x + layout.lid.diameter / 2);
    expect(lidGap).toBeGreaterThan(4);
    expect(layout.scoop.x).toBeGreaterThan(layout.tub.x);
    expect(layout.scoop.x).toBeLessThan(layout.mill.x);
  });

  it('keeps the rim short enough that a 15 mm fly can dip with the authored scoop', () => {
    expect(TUB_MM.height).toBeLessThan(flyVisualLengthMm() * 2);
    expect(TUB_MM.height).toBeGreaterThan(flyVisualLengthMm());
    expect(TUB_MM.diameter / TUB_MM.height).toBeGreaterThan(1.5);
  });

  it('builds a labelled cylinder with a front anchor on −Z', () => {
    const tub = createCreatineTub();
    expect(tub.group.name).toBe('kfdTub');
    expect(tub.group.getObjectByName('kfdLabel')).toBeTruthy();
    expect(tub.group.getObjectByName('kfdLid')).toBeTruthy();
    expect(tub.labelAnchor.position.z).toBeLessThan(0);
    expect(Math.abs(tub.labelAnchor.position.z)).toBeCloseTo(tubRadiusMm());
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
    const frame = tubLabelFrame();
    const layout = kitchenLayout();
    expect(frame.lookAt[2]).toBeLessThan(layout.tub.z);
    expect(frame.position[2]).toBeLessThan(layout.tub.z - layout.tub.diameter / 2 - 40);
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
