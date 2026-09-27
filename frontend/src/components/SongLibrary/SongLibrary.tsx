import { useEffect, useRef, useState } from "react";
import { importSong, MUSIC_FILE_TYPES, openSavedSong, useSongLibrary } from "../../library/useSongLibrary";

export function SongLibrary() {
  const { songs, currentId, busy, error } = useSongLibrary();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const filtered = songs.filter((song) => song.name.toLowerCase().includes(search.toLowerCase()));
  const button = { border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface-2)", color: "var(--color-text)", cursor: "pointer", padding: "7px 12px" };

  return (
    <>
      <button onClick={() => setOpen(true)} title="Switch songs or import another file" aria-label="Open song library" style={{ ...button, marginLeft: 16, fontSize: 12, fontWeight: 600 }}>
        ♫ Songs{songs.length > 0 ? ` (${songs.length})` : ""}
      </button>
      {error && !open && (
        <div role="alert" style={{ position: "fixed", top: 52, left: 16, zIndex: 1001, maxWidth: 440, padding: 12, borderRadius: 8, background: "var(--color-surface)", border: "1px solid var(--color-warning)", color: "var(--color-text)", fontSize: 13 }}>
          {error} <button style={button} onClick={() => useSongLibrary.setState({ error: null })}>Dismiss</button>
        </div>
      )}
      <dialog ref={dialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} aria-labelledby="song-library-title" style={{ margin: "auto", padding: 0, width: 520, maxWidth: "calc(100vw - 48px)", maxHeight: "min(680px, calc(100vh - 64px))", border: "1px solid var(--color-border)", borderRadius: 16, color: "var(--color-text)", background: "var(--color-surface)", boxShadow: "0 24px 80px rgba(0,0,0,.3)" }}>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 id="song-library-title" style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Your songs</h2>
              <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>Saved on this device. Pick a song to practice.</p>
            </div>
            <button aria-label="Close song library" onClick={() => setOpen(false)} style={button}>✕</button>
          </div>
          <input aria-label="Search saved songs" placeholder="Search songs…" value={search} onChange={(event) => setSearch(event.target.value)} style={{ ...button, cursor: "text", width: "100%", boxSizing: "border-box", padding: 12 }} />
          {error && <p role="alert" style={{ color: "var(--color-warning)", fontSize: 13, margin: 0 }}>{error}</p>}
          {busy && <p role="status" style={{ fontSize: 13, margin: 0 }}>Opening and saving song…</p>}
          <div style={{ maxHeight: "45vh", overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <p style={{ padding: "32px 0", textAlign: "center", color: "var(--color-text-muted)", fontSize: 14 }}>
                {songs.length ? "No songs match your search." : "Import your first song. It will be saved here for next time."}
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {filtered.map((song) => (
                  <li key={song.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <button data-song-id={song.id} aria-label={`Open song ${song.name}`} aria-current={song.id === currentId ? "true" : undefined} disabled={busy} onClick={async () => { await openSavedSong(song.id); if (!useSongLibrary.getState().error) setOpen(false); }} style={{ width: "100%", border: 0, padding: "14px 12px", textAlign: "left", borderRadius: 8, cursor: busy ? "wait" : "pointer", color: "var(--color-text)", background: song.id === currentId ? "var(--color-surface-2)" : "transparent", opacity: busy ? .6 : 1 }}>
                      <span style={{ display: "block", fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{song.name.replace(/\.[^.]+$/, "")}</span>
                      <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "var(--color-text-muted)" }}>{song.name.split(".").pop()?.toUpperCase()}{song.id === currentId ? " · Current song" : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button disabled={busy} onClick={() => picker.current?.click()} style={{ ...button, padding: 12, background: "var(--color-accent)", color: "white", fontWeight: 600, opacity: busy ? .6 : 1 }}>＋ Import another song</button>
          <input ref={picker} type="file" accept={MUSIC_FILE_TYPES} style={{ display: "none" }} onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) { await importSong(file); if (!useSongLibrary.getState().error) setOpen(false); } }} />
        </div>
      </dialog>
    </>
  );
}
