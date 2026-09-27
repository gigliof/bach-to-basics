import { describe, expect, it } from 'vitest';
import { restorePreferences, serializePreferences } from './preferences';
import type { AppSettings } from './useAppStore';
const defaults = {
  theme: 'light', activeHands: new Set(['left', 'right']), handVolume: { left: 1, right: 1 },
  handVolumesLinked: true, layoutMode: 'falling', instrument: 'grand', renderOffset: 0,
  speedTrainer: { enabled: false, startPct: 60, endPct: 100, stepPct: 5, currentPct: 60 },
  customColors: { leftHand: '#123456', rightHand: '#abcdef', unknown: '#123abc' },
} as AppSettings;
describe('saved app preferences', () => {
  it('round-trips muted hands, independent volumes, nested options and transport settings', () => {
    const state = { settings: { ...defaults, activeHands: new Set<'left' | 'right'>(['left']), handVolume: { left: .2, right: .7 }, handVolumesLinked: false, layoutMode: 'sheet' as const }, tempoMultiplier: .75, waitMode: true };
    expect(restorePreferences(serializePreferences(state), defaults)).toEqual(state);
  });
  it('preserves muting both hands', () => {
    expect(restorePreferences(JSON.stringify({ settings: { activeHands: [] } }), defaults).settings.activeHands.size).toBe(0);
  });
  it('merges older preferences with new and nested defaults', () => {
    const restored = restorePreferences(JSON.stringify({ settings: { handVolume: { left: .3 }, theme: 'dark' } }), defaults);
    expect(restored.settings.handVolume).toEqual({ left: .3, right: 1 });
    expect(restored.settings.handVolumesLinked).toBe(true);
    expect(restored.settings.theme).toBe('dark');
  });
  it('rejects corrupted values and clamps out-of-range values', () => {
    const restored = restorePreferences(JSON.stringify({ settings: { activeHands: ['invalid'], theme: 'purple', instrument: {}, handVolumesLinked: 'false', handVolume: { left: -10, right: 20 }, customColors: { leftHand: 'bad' }, renderOffset: 900 }, tempoMultiplier: 90, waitMode: 'true' }), defaults);
    expect(restored.settings.activeHands).toEqual(defaults.activeHands);
    expect(restored.settings.theme).toBe('light');
    expect(restored.settings.instrument).toBe('grand');
    expect(restored.settings.handVolumesLinked).toBe(true);
    expect(restored.settings.customColors.leftHand).toBe('#123456');
    expect(restored.settings.handVolume).toEqual({ left: 0, right: 1 });
    expect(restored.settings.renderOffset).toBe(200);
    expect(restored.tempoMultiplier).toBe(2);
    expect(restored.waitMode).toBe(false);
  });
  it('survives missing and damaged storage without sharing mutable defaults', () => {
    for (const raw of [null, 'broken{', 'null', '[]']) {
      const restored = restorePreferences(raw, defaults);
      expect(restored.settings).toEqual(defaults);
      expect(restored.settings.activeHands).not.toBe(defaults.activeHands);
      expect(restored.settings.speedTrainer).not.toBe(defaults.speedTrainer);
    }
  });
  it('only serializes preferences, never playing status or device connection', () => {
    const state = { settings: defaults, tempoMultiplier: 1, waitMode: false, status: 'playing', midiEnabled: true };
    expect(Object.keys(JSON.parse(serializePreferences(state)))).toEqual(['settings', 'tempoMultiplier', 'waitMode']);
  });
});
