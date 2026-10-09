/** Presentation-only landscape selection. Never owns an aircraft or simulation clock. */
export type LandscapePreset = 'mountains' | 'islands';
export const LANDSCAPE_STORAGE_KEY = 'skycaptain.landscape.v1';
export function isLandscapePreset(value: unknown): value is LandscapePreset {
  return value === 'mountains' || value === 'islands';
}
export function readLandscapePreset(url: URL, readStored?: () => unknown): LandscapePreset {
  const query = url.searchParams.get('landscape');
  if (isLandscapePreset(query)) return query;
  try {
    const stored = readStored?.();
    if (isLandscapePreset(stored)) return stored;
  } catch {
    // Private browsing or blocked storage must not prevent the 3D scene loading.
  }
  return 'mountains';
}
export function rememberLandscapePreset(
  value: LandscapePreset,
  writeStored: (value: string) => void,
) {
  if (!isLandscapePreset(value)) return false;
  try {
    writeStored(value);
    return true;
  } catch {
    return false;
  }
}
export function landscapeUrl(current: URL, value: LandscapePreset) {
  const next = new URL(current.href);
  if (isLandscapePreset(value)) next.searchParams.set('landscape', value);
  return next;
}
