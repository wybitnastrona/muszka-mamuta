import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeFlybodyHierarchy, type FlybodyMeta } from '../../src/body/hierarchy.ts';
import { splitMembraneWings } from '../../src/body/wings.ts';

const meta = JSON.parse(
  readFileSync(new URL('../../public/data/flybody/model.json', import.meta.url), 'utf8'),
) as FlybodyMeta;

describe('membrane wings', () => {
  it('has a membrane part and no wings material', () => {
    const report = describeFlybodyHierarchy(meta);
    expect(report.materialsByGroup.body).toContain('membrane');
    expect(report.materialsByGroup.body).not.toContain('wings');
  });

  it('splits membrane into wing_L (+) and wing_R (−) by centroid X', () => {
    const part = meta.parts.find((p) => p.group === 'body' && p.material === 'membrane');
    expect(part).toBeDefined();
    const bin = readFileSync(new URL('../../public/data/flybody/model.bin', import.meta.url));
    const positions = new Float32Array(
      bin.buffer,
      bin.byteOffset + part!.positionByteOffset,
      part!.positionCount * 3,
    );
    const indices = new Uint32Array(
      bin.buffer,
      bin.byteOffset + part!.indexByteOffset,
      part!.indexCount,
    );
    const split = splitMembraneWings(new Float32Array(positions), new Uint32Array(indices));
    expect(split.wing_L.centroid[0]).toBeGreaterThan(0);
    expect(split.wing_R.centroid[0]).toBeLessThan(0);
    expect(split.wing_L.positions.length).toBeGreaterThan(30);
    expect(split.wing_R.positions.length).toBeGreaterThan(30);
  });
});
