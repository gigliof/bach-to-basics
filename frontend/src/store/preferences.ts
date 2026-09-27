import type { AppSettings } from './useAppStore';

export const PREFERENCES_KEY = 'bach-to-basics-preferences-v1';
const choices: Record<string, readonly unknown[]> = {
  theme: ['dark', 'light'], noteFilter: ['all', 'white', 'black', 'c_only'],
  colorTheme: ['violet', 'classic', 'ocean', 'forest', 'cascade', 'custom'],
  layoutMode: ['falling', 'sheet', 'piano', 'all'],
  noteLabelMode: ['none', 'c_only', 'white', 'black', 'all'],
  fallingNotesLabelMode: ['none', 'c_only', 'white', 'black', 'all'],
  pianoTheme: ['white', 'ivory'], countInBars: [0, 1, 2],
  impactStyle: ['off', 'bloom', 'side', 'trail'],
  instrument: ['grand', 'bright', 'electric', 'harpsichord', 'honkytonk'],
  waitForHand: ['left', 'right', 'both'],
};
const bounds: Record<string, [number, number]> = {
  keyboardHeight: [80, 4000], viewportSeconds: [1, 20], volume: [0, 1], transposeSemitones: [-12, 12],
  minNoteHeight: [4, 24], noteCornerRadius: [0, 12], renderOffset: [-200, 200],
  left: [0, 1], right: [0, 1], startPct: [25, 200], endPct: [25, 200],
  stepPct: [1, 100], currentPct: [25, 200],
};
function merge(defaults: unknown, saved: unknown, key = ''): unknown {
  if (defaults instanceof Set) {
    return new Set(Array.isArray(saved) && saved.every(v => v === 'left' || v === 'right') ? saved : defaults);
  }
  if (defaults && typeof defaults === 'object') {
    const source = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
    return Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, merge(v, source[k], k)]));
  }
  if (choices[key]) return choices[key].includes(saved) ? saved : defaults;
  if (typeof defaults === 'number') {
    if (typeof saved !== 'number' || !Number.isFinite(saved)) return defaults;
    const [min, max] = bounds[key] ?? [-Infinity, Infinity];
    return Math.max(min, Math.min(max, saved));
  }
  if (typeof defaults === 'string' && defaults.startsWith('#')) {
    return typeof saved === 'string' && /^#[\da-f]{6}$/i.test(saved) ? saved : defaults;
  }
  return typeof saved === typeof defaults ? saved : defaults;
}
export function restorePreferences(raw: string | null, defaults: AppSettings) {
  let saved: Record<string, unknown> = {};
  try { const parsed = JSON.parse(raw ?? '{}'); if (parsed && typeof parsed === 'object') saved = parsed; } catch { /* damaged or older storage */ }
  return {
    settings: merge(defaults, saved.settings) as AppSettings,
    tempoMultiplier: typeof saved.tempoMultiplier === 'number' && Number.isFinite(saved.tempoMultiplier)
      ? Math.max(.25, Math.min(2, saved.tempoMultiplier)) : 1,
    waitMode: saved.waitMode === true,
  };
}
export function serializePreferences(state: { settings: AppSettings; tempoMultiplier: number; waitMode: boolean }) {
  return JSON.stringify({ settings: { ...state.settings, activeHands: [...state.settings.activeHands] }, tempoMultiplier: state.tempoMultiplier, waitMode: state.waitMode });
}
