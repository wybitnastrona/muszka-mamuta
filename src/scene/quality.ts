/**
 * Authored render quality. Not connectome data.
 * Mobile: no shadows, 1024 maps, no DOF — keep the 60 fps budget.
 */

export type RenderQuality = {
  mobile: boolean;
  shadows: boolean;
  shadowMapSize: number;
  textureSize: number;
  dof: boolean;
  clearcoat: boolean;
  iridescence: boolean;
};

export const DESKTOP_QUALITY: RenderQuality = {
  mobile: false,
  shadows: true,
  shadowMapSize: 2048,
  textureSize: 1024,
  dof: true,
  clearcoat: true,
  iridescence: true,
};

export const MOBILE_QUALITY: RenderQuality = {
  mobile: true,
  shadows: false,
  shadowMapSize: 1,
  textureSize: 1024,
  dof: false,
  clearcoat: true,
  iridescence: true,
};

export function detectMobileLook(
  width = typeof window === 'undefined' ? 1280 : window.innerWidth,
  coarse = typeof window === 'undefined'
    ? false
    : window.matchMedia('(pointer: coarse)').matches,
): boolean {
  return coarse || width <= 760;
}

export function detectQuality(
  opts: { width?: number; coarse?: boolean } = {},
): RenderQuality {
  return detectMobileLook(opts.width, opts.coarse) ? { ...MOBILE_QUALITY } : { ...DESKTOP_QUALITY };
}
