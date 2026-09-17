import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BOARD_STEP_S,
  SceneDirector,
} from '../../src/body/sceneDirector.ts';
import { pointInObb3, type Obb3 } from '../../src/body/collision.ts';
import { CreatineSystem } from '../../src/food/creatineSystem.ts';
import { fractureCurdBlock } from '../../src/food/proceduralTwarog.ts';
import { TwarogSystem, pointInXzAabb } from '../../src/food/twarogSystem.ts';
import {
  createCuttingBoard,
  type BoardMaps,
} from '../../src/scene/CuttingBoard.tsx';
import {
  boardLocalToWorld,
  kitchenLayout,
  pointInBoardFootprint,
} from '../../src/scene/layout.ts';
import {
  BOARD_EDGE_RADIUS_MM,
  BOARD_LOGO_WIDTH_MM,
  BOARD_MM,
  BOARD_YAW_DEG,
  PILE_MM,
  TUB_MM,
  boardTopY,
  tableTopY,
  mm,
} from '../../src/scene/scale.ts';
import {
  fillLongGrainOak,
  luminanceToNormalMap,
  medianRgbFromRgba,
} from '../../src/scene/proceduralMaps.ts';
import { DESKTOP_QUALITY } from '../../src/scene/quality.ts';

function standY(): number {
  return kitchenLayout().board.topY + 2;
}

function makeDirector() {
  const layout = kitchenLayout();
  const food = CreatineSystem.create({ seed: 1, store: null });
  return new SceneDirector({
    food,
    foodOrigin: { x: layout.pile.x, y: layout.pile.y, z: layout.pile.z },
    pouch: {
      cx: layout.mill.x,
      cz: layout.mill.z,
      hx: layout.mill.hx,
      hz: layout.mill.hz,
      yaw: layout.mill.yaw,
    },
    position: { x: layout.fly.x, y: standY(), z: layout.fly.z },
    heading: 0.35,
  });
}

function stubBoardMaps(): BoardMaps {
  const mk = () => {
    const t = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    t.needsUpdate = true;
    return t;
  };
  return {
    top: mk(),
    topNormal: mk(),
    logo: mk(),
    logoAspect: 390 / 210,
    median: new THREE.Color(0.72, 0.52, 0.32),
  };
}

function boardObb(): Obb3 {
  const { board } = kitchenLayout();
  return {
    cx: board.x, cy: board.y, cz: board.z,
    hx: board.hx, hy: board.hy, hz: board.hz, yaw: board.yaw,
  };
}

describe('cutting board', () => {
  it('is a 400×300×40 mm rounded box, yawed 12°, with a 120 mm front logo', () => {
    const maps = stubBoardMaps();
    const board = createCuttingBoard(maps, { quality: { ...DESKTOP_QUALITY, textureSize: 16 } });
    expect(board.group.name).toBe('cuttingBoard');
    expect(board.body.name).toBe('cuttingBoardBody');
    expect(board.logo.name).toBe('boardLogo');
    expect(board.group.rotation.y).toBeCloseTo((BOARD_YAW_DEG * Math.PI) / 180);
    expect(board.group.position.y).toBeCloseTo(boardTopY() / 2);
    board.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(board.group);
    expect(box.max.y).toBeCloseTo(BOARD_MM.height, 1);
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(BOARD_EDGE_RADIUS_MM).toBe(6);
    const logoSize = (board.logo.geometry as THREE.PlaneGeometry).parameters;
    expect(logoSize.width).toBeCloseTo(BOARD_LOGO_WIDTH_MM);
    const mats = board.body.material as THREE.Material[];
    const top = mats[2] as THREE.MeshPhysicalMaterial;
    expect(top.normalMap).toBe(maps.topNormal);
    expect(top.normalScale.x).toBeCloseTo(0.6);
    expect(top.roughness).toBeCloseTo(0.55);
    expect(top.clearcoat).toBeCloseTo(0.15);
    const side = mats[0] as THREE.MeshStandardMaterial;
    expect(side.roughness).toBeCloseTo(0.6);
    board.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  });

  it('keeps the powder mound on the table top', () => {
    const layout = kitchenLayout();
    expect(layout.pile.y - mm(PILE_MM.height) / 2).toBeCloseTo(layout.board.topY + mm(TUB_MM.wall));
    expect(layout.mill.deckY).toBeGreaterThan(layout.board.topY);
    expect(layout.board.topY).toBe(tableTopY());
  });
});

describe('supportHeightAt table / board / block', () => {
  it('returns 0 off the board, board top on the oak, chunk tops on the block', () => {
    const layout = kitchenLayout();
    const origin = { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z };
    const sys = TwarogSystem.fromFracture(fractureCurdBlock({ seed: 1 }), { store: null });
    expect(sys.supportHeightAt(400, 400, origin)).toBe(0);
    expect(pointInBoardFootprint(400, 400)).toBe(false);

    const onBoard = boardLocalToWorld(0, layout.board.hz * 0.75);
    expect(pointInBoardFootprint(onBoard.x, onBoard.z)).toBe(true);
    expect(pointInXzAabb(onBoard, sys.worldAabb(origin))).toBe(false);
    expect(sys.supportHeightAt(onBoard.x, onBoard.z, origin)).toBe(tableTopY());

    // Tallest *uneaten* cell: the opening-bite crater cells are gone at serve time.
    const top = sys.chunks.filter((c) => !c.eaten).reduce((a, c) => (c.topY > a.topY ? c : a));
    const wx = origin.x + top.centroid.x;
    const wz = origin.z + top.centroid.z;
    const blockY = sys.supportHeightAt(wx, wz, origin);
    expect(blockY).toBeCloseTo(origin.y + top.topY, 5);
    expect(blockY).toBeGreaterThan(tableTopY());
  });
});

describe('fly on the board', () => {
  it('never sinks into the board volume while standing on it', () => {
    const d = makeDirector();
    const obb = boardObb();
    const drive = {
      dt: 1 / 60, mn9Rate: 0, satiety: 0.2, bitter: 0, odor: 1, cameraDist: 400,
    };
    for (let i = 0; i < 45; i++) {
      d.update(drive);
      if (pointInBoardFootprint(d.position.x, d.position.z)) {
        expect(d.position.y).toBeGreaterThanOrEqual(tableTopY() - 0.05);
      }
      expect(pointInObb3(d.position, obb, -0.05)).toBe(false);
    }
  });

  it('eases standing Y toward the table instead of teleporting', () => {
    const d = makeDirector();
    const layout = kitchenLayout();
    const offX = layout.table.width / 2 + 40;
    d.position.set(offX, 20, 0);
    expect(pointInBoardFootprint(offX, 0)).toBe(false);
    const drive = {
      dt: 1 / 60, mn9Rate: 0, satiety: 0.2, bitter: 0, odor: 1, cameraDist: 400,
    };
    const mid = d.update(drive);
    expect(mid.flyPose.position.y).toBeLessThan(24);
    expect(mid.flyPose.position.y).toBeGreaterThan(2);
    const steps = Math.ceil(BOARD_STEP_S / drive.dt) + 2;
    let y = mid.flyPose.position.y;
    for (let i = 0; i < steps; i++) y = d.update(drive).flyPose.position.y;
    expect(y).toBeCloseTo(2, 0);
    expect(BOARD_STEP_S).toBeGreaterThan(0.1);
  });
});

describe('luminance normals and long grain', () => {
  it('writes a non-flat normal map and streaks along U', () => {
    const w = 8;
    const h = 8;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = x > 3 ? 220 : 40;
        rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255;
      }
    }
    const nrm = luminanceToNormalMap(rgba, w, h);
    let minR = 255;
    let maxR = 0;
    for (let i = 0; i < nrm.length; i += 4) {
      minR = Math.min(minR, nrm[i]!);
      maxR = Math.max(maxR, nrm[i]!);
    }
    expect(maxR).toBeGreaterThan(minR);
    const [mr, mg, mb] = medianRgbFromRgba(rgba, w, h, 1);
    expect(mr).toBeGreaterThan(0);
    expect(mg).toBeGreaterThan(0);
    expect(mb).toBeGreaterThan(0);
    const grain = new Uint8Array(16 * 16 * 4);
    fillLongGrainOak(grain, 16, 3, [180, 140, 90]);
    expect(grain[0]).toBeGreaterThan(0);
    expect(grain[3]).toBe(255);
  });
});
