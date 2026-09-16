import type { AnchorFile } from './types.ts';
import anchorsJson from './anchors.json';

export const ANCHORS = anchorsJson as unknown as AnchorFile;

export type FlybodyMeta = {
  binary: string;
  pivots: Record<string, [number, number, number]>;
  parts: {
    group: string;
    material: string;
    positionByteOffset: number;
    positionCount: number;
    indexByteOffset: number;
    indexCount: number;
  }[];
};

export type HierarchyReport = {
  groups: string[];
  materialsByGroup: Record<string, string[]>;
  hasSkeleton: false;
  namedLegGroups: string[];
  bodyUnrigged: true;
};

export function describeFlybodyHierarchy(meta: FlybodyMeta): HierarchyReport {
  const groups: string[] = [];
  const materialsByGroup: Record<string, string[]> = {};
  for (const part of meta.parts) {
    if (!groups.includes(part.group)) groups.push(part.group);
    const list = materialsByGroup[part.group] ?? [];
    if (!list.includes(part.material)) list.push(part.material);
    materialsByGroup[part.group] = list;
  }
  const namedLegGroups = groups.filter((g) => g === 'front_left' || g === 'front_right');
  return {
    groups,
    materialsByGroup,
    hasSkeleton: false,
    namedLegGroups,
    bodyUnrigged: true,
  };
}
