import { rememberSongPractice } from "./songPractice";
import { create } from "zustand";
import { useAppStore } from "../store/useAppStore";
import { lastSong, listSongs, readSong, saveSong, type SavedSong } from "./songDatabase";

export const MUSIC_FILE_TYPES = ".mid,.midi,.xml,.musicxml,.mxl,.pdf,.mp3,.wav,.m4a,.ogg,.flac,.aac";
export const useSongLibrary = create<{
  songs: SavedSong[];
  currentId: string | null;
  busy: boolean;
  error: string | null;
}>(() => ({ songs: [], currentId: null, busy: false, error: null }));
let queue: Promise<void> = Promise.resolve();
let userOpenedSong = false;
let initialization: Promise<void> | undefined;

async function load(file: File) {
  const store = useAppStore.getState();
  const previous = store.document?.id;
  if (/\.midi?$/i.test(file.name)) await store.loadMidiFile(file);
  else if (/\.(xml|musicxml|mxl)$/i.test(file.name)) await store.loadMusicXmlFile(file);
  else if (/\.pdf$/i.test(file.name)) await store.loadPdfFile(file);
  else if (/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name)) await store.loadAudioFile(file);
  else throw new Error("Choose a MIDI, MusicXML, PDF, or audio file.");
  const state = useAppStore.getState();
  if (state.loadError || !state.document || state.document.id === previous) {
    throw new Error(state.loadError ?? "The song could not be loaded.");
  }
}
function enqueue(getFile: () => Promise<File>, userAction: boolean) {
  if (userAction) userOpenedSong = true;
  const task = queue.then(async () => {
    useSongLibrary.setState({ busy: true, error: null });
    try {
      const file = await getFile();
      if (file.size > 50 * 1024 * 1024) throw new Error("Choose a file smaller than 50 MB.");
      await load(file);
      useSongLibrary.setState({ currentId: null });
      try {
        const id = await saveSong(file);
        useSongLibrary.setState({ songs: await listSongs(), currentId: id });
        rememberSongPractice(id);
      } catch {
        throw new Error("The song is open, but could not be saved to your library. Check available disk space and import it again.");
      }
    } catch (error) {
      useSongLibrary.setState({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      useSongLibrary.setState({ busy: false });
    }
  });
  queue = task;
  return task;
}
export function importSong(file: File) {
  return enqueue(async () => file, true);
}
export function openSavedSong(id: string) {
  return enqueue(() => readSong(id), true);
}
export function initializeSongLibrary() {
  return initialization ??= (async () => {
    try {
      const [songs, id] = await Promise.all([listSongs(), lastSong()]);
      useSongLibrary.setState({ songs });
      // A Finder-opened file or early import takes precedence over restoration.
      if (id && !userOpenedSong && !useAppStore.getState().document) {
        await enqueue(() => readSong(id), false);
      }
    } catch {
      useSongLibrary.setState({ error: "Your saved songs could not be read. You can still import a file." });
    }
  })();
}
