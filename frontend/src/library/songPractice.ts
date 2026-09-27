import { useAppStore } from '../store/useAppStore';

let binding: { songId: string; documentId: string; pending: boolean } | null = null;
const key = (id: string) => `bach-to-basics-loop-v1:${id}`;

function restoreLoop() {
  const current = binding;
  const state = useAppStore.getState();
  if (!current?.pending || state.document?.id !== current.documentId || !state.document.totalDuration) return;
  // Conversion installs the document in the store before the playback engine.
  queueMicrotask(() => {
    if (binding !== current || !current.pending) return;
    current.pending = false;
    try {
      const saved = JSON.parse(localStorage.getItem(key(current.songId)) ?? 'null');
      if (saved && typeof saved.start === 'number' && Number.isFinite(saved.start) && typeof saved.end === 'number' && Number.isFinite(saved.end)) {
        useAppStore.getState().setLoopPoints(saved.start, saved.end);
      }
    } catch { /* missing or damaged song preferences use the default loop */ }
  });
}

export function rememberSongPractice(songId: string) {
  const documentId = useAppStore.getState().document?.id;
  if (!documentId) return;
  binding = { songId, documentId, pending: true };
  restoreLoop();
}

useAppStore.subscribe((state, previous) => {
  if (!binding || state.document?.id !== binding.documentId) return;
  if (binding.pending) { restoreLoop(); return; }
  if (state.loopStart === previous.loopStart && state.loopEnd === previous.loopEnd) return;
  try { localStorage.setItem(key(binding.songId), JSON.stringify({ start: state.loopStart, end: state.loopEnd })); } catch { /* storage unavailable */ }
});
