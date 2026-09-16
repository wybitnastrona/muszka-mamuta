/** `?reel=1` hides chrome and leaves the raster + slogan. */
export function parseReelMode(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(raw).get('reel') === '1';
}

export const REEL_SLOGAN_PL = 'Zmusiłem muszkę do jedzenia twarogu waniliowego na wieczność';
export const REEL_SLOGAN_EN = 'I made the fly eat vanilla twaróg for eternity';
