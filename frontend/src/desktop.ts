import { importSong } from './library/useSongLibrary';

declare global {
  interface Window {
    desktop?: {
      onOpenFile(callback: (file: { name: string; bytes: Uint8Array }) => void): () => void;
    };
  }
}

// File > Open and Finder documents use the same import paths as drag and drop.
window.desktop?.onOpenFile(({ name, bytes }) => {
  const file = new File([new Uint8Array(bytes)], name);
  void importSong(file);
});
