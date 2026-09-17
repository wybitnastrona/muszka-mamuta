export const BONE_NAMES = [
  'root',
  'abdomen',
  'head',
  'antenna_L',
  'antenna_R',
  'rostrum',
  'haustellum',
  'labellum_L',
  'labellum_R',
  'foreleg_L_tarsus',
  'foreleg_R_tarsus',
  'midleg_L',
  'midleg_R',
  'hindleg_L',
  'hindleg_R',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

export type Quat = readonly [number, number, number, number];
export type EulerDeg = readonly [number, number, number];
export type Vec3 = readonly [number, number, number];

export const MOUTHPART_BONES = ['rostrum', 'haustellum', 'labellum_L', 'labellum_R'] as const;
export type MouthpartBone = (typeof MOUTHPART_BONES)[number];

/** Flybody `model.json` names the compound-eye part `red`. `eyes` is the alias used in exclude lists. */
export const EYE_MATERIAL_ALIAS: Record<string, string> = {
  eyes: 'red',
  red: 'red',
  ocelli: 'ocelli',
};

/** Vertex gate so a spherical falloff cannot reach the thorax or the other legs. */
export type WeightGate = {
  yMax: number;
  absXMin: number;
  zMin: number;
  zMax: number;
  xSign: 1 | -1;
};

export type BoneAnchor = {
  name: BoneName;
  parent: BoneName | null;
  position: Vec3;
  maxRadius: number;
  excludeMaterials?: string[];
  legGroup?: 'front_left' | 'front_right';
  weightGate?: WeightGate;
};

export type AnchorFile = {
  comment: string;
  space: string;
  up: Vec3;
  forward: Vec3;
  aabbSize?: Vec3;
  aabbDiag?: number;
  bones: BoneAnchor[];
};

export const CLIP_NAMES = [
  'odorTrack',
  'approach',
  'tarsalTaste',
  'per',
  'pump',
  'retract',
  'groom',
  'idle',
] as const;

export type ClipName = (typeof CLIP_NAMES)[number];

export const FEEDING_STATES = [
  'SEARCH',
  'ORIENT',
  'APPROACH',
  'TASTE',
  'EXTEND',
  'PUMP',
  'RETRACT',
  'REST',
] as const;

export type FeedingState = (typeof FEEDING_STATES)[number];

export type BonePose = { rotation: Quat };

export type Pose = Record<BoneName, BonePose>;

export const CAMERA_PRESETS = ['Widok kuchni', 'Z boku', 'Zbliżenie', 'Przegląd', 'Reel'] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];

export type FeedingEvent =
  | { type: 'transition'; from: FeedingState; to: FeedingState; t: number }
  | { type: 'bite'; cycle: number; t: number }
  | { type: 'consume'; massGrams: number; chunkId: number; t: number; centroid?: { x: number; y: number; z: number } }
  | { type: 'portion'; count: number; t: number };

export type DebugMode = 'off' | 'weights' | 'motion' | 'extend' | 'pump' | 'label' | 'gate' | 'flight';
