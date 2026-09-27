export interface SavedSong {
  id: string;
  name: string;
  size: number;
  importedAt: number;
  lastOpenedAt: number;
}
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("bach-to-basics-songs", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("songs", { keyPath: "id" });
      request.result.createObjectStore("files");
      request.result.createObjectStore("settings");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function complete(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Could not save the song library."));
  });
}
export async function listSongs(): Promise<SavedSong[]> {
  const songs = await result((await db()).transaction("songs").objectStore("songs").getAll()) as SavedSong[];
  return songs.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}
export async function lastSong(): Promise<string | undefined> {
  return result((await db()).transaction("settings").objectStore("settings").get("lastSong"));
}
export async function saveSong(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  // Content identity avoids duplicates when the same file is imported again.
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const id = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
  const connection = await db();
  const existing = await result(connection.transaction("songs").objectStore("songs").get(id)) as SavedSong | undefined;
  const tx = connection.transaction(["songs", "files", "settings"], "readwrite");
  const done = complete(tx);
  tx.objectStore("songs").put({ id, name: file.name, size: file.size, importedAt: existing?.importedAt ?? Date.now(), lastOpenedAt: Date.now() });
  tx.objectStore("files").put(bytes, id);
  tx.objectStore("settings").put(id, "lastSong");
  await done;
  return id;
}
export async function readSong(id: string): Promise<File> {
  const tx = (await db()).transaction(["songs", "files"]);
  const [song, bytes] = await Promise.all([
    result(tx.objectStore("songs").get(id)) as Promise<SavedSong | undefined>,
    result(tx.objectStore("files").get(id)) as Promise<ArrayBuffer | undefined>,
  ]);
  if (!song || !bytes) throw new Error("This song could not be found in your library. Import it again.");
  return new File([bytes], song.name);
}
