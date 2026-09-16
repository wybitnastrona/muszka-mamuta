import type { DebugMode } from './types.ts';

export function parseDebugMode(search = typeof window === 'undefined' ? '' : window.location.search): DebugMode {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('debug');
  if (raw === 'weights' || raw === 'motion' || raw === 'extend' || raw === 'pump') return raw;
  return 'off';
}
