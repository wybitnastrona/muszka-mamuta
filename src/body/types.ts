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
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

export type Quat = readonly [number, number, number, number];
export type EulerDeg = readonly [number, number, number];
export type Vec3 = readonly [number, number, number];

export type BoneAnchor = {
  name: BoneName;
  parent: BoneName | null;
  position: Vec3;
  radius: number;
  legGroup?: 'front_left' | 'front_right';
};

export type AnchorFile = {
  comment: string;
  space: string;
  up: Vec3;
  forward: Vec3;
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

export const CAMERA_PRESETS = ['Widok kuchni', 'Z boku', 'Zbliżenie'] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];

export type FeedingEvent =
  | { type: 'transition'; from: FeedingState; to: FeedingState; t: number }
  | { type: 'bite'; cycle: number; t: number };

export type DebugMode = 'off' | 'weights' | 'motion' | 'extend' | 'pump';
