/**
 * Remembers the user's settings and the last loaded song between visits.
 *
 * - Settings: localStorage (small, read synchronously at startup so the first
 *   paint already uses them).
 * - Last song: IndexedDB (can be several MB: MIDI bytes + MusicXML + notes).
 *
 * Everything here is best-effort: private mode, full storage or a blocked
 * database just means nothing is remembered - never an error for the user.
 */
import type { MusicDocument } from "@bach-to-basics/shared";
import type { AppSettings } from "./useAppStore";

const SETTINGS_KEY = "b2b-settings";
const SETTINGS_VERSION = 1;

/** Not stored in the settings blob: theme has its own key (it keeps following
 * the OS preference until the user picks one). */
const NOT_PERSISTED = new Set<keyof AppSettings>(["theme"]);

/** Settings -> JSON-safe object (Sets become arrays). */
export function serializeSettings(settings: AppSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (NOT_PERSISTED.has(key as keyof AppSettings)) continue;
    out[key] = value instanceof Set ? [...value] : value;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Merge stored values over the defaults, keeping only keys the app knows and
 * values of the same shape as the default. Anything else (renamed settings,
 * hand-edited storage, older versions) silently falls back to the default.
 */
export function mergeStoredSettings(stored: unknown, defaults: AppSettings): AppSettings {
  const merged = { ...defaults } as Record<string, unknown>;
  if (!isPlainObject(stored)) return defaults;
  for (const [key, def] of Object.entries(defaults)) {
    if (NOT_PERSISTED.has(key as keyof AppSettings) || !(key in stored)) continue;
    const value = stored[key];
    if (def instanceof Set) {
      if (Array.isArray(value) && value.every((v) => typeof v === "string"))
        merged[key] = new Set(value);
    } else if (isPlainObject(def)) {
      // Nested settings (colors, hand volume, speed trainer): merge field by field
      if (isPlainObject(value)) {
        const nested = { ...def };
        for (const [k, d] of Object.entries(def))
          if (typeof value[k] === typeof d) nested[k] = value[k];
        merged[key] = nested;
      }
    } else if (typeof value === typeof def) {
      merged[key] = value;
    }
  }
  return merged as unknown as AppSettings;
}

export function loadSettings(defaults: AppSettings): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed) || parsed.version !== SETTINGS_VERSION) return defaults;
    return mergeStoredSettings(parsed.settings, defaults);
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ version: SETTINGS_VERSION, settings: serializeSettings(settings) })
    );
  } catch {
    /* storage unavailable or full - ignore */
  }
}

// ── Last song (IndexedDB) ─────────────────────────────────────────────────────

const DB_NAME = "bach-to-basics";
const STORE = "session";
const LAST_DOC_KEY = "lastDocument";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** A song worth restoring: fully imported (has notes to play). */
export function isRestorable(doc: MusicDocument | null): doc is MusicDocument {
  return !!doc && Array.isArray(doc.notes) && doc.notes.length > 0;
}

export async function saveLastDocument(doc: MusicDocument): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(doc, LAST_DOC_KEY));
  } catch {
    /* quota exceeded / private mode - the song just won't be remembered */
  }
}

export async function loadLastDocument(): Promise<MusicDocument | null> {
  try {
    if (typeof indexedDB === "undefined") return null;
    const doc = await withStore<unknown>("readonly", (s) => s.get(LAST_DOC_KEY));
    return isRestorable(doc as MusicDocument) ? (doc as MusicDocument) : null;
  } catch {
    return null;
  }
}
