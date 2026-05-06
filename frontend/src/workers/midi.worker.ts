// Web Worker: parses MIDI ArrayBuffer --> NoteEvent[] + metadata
// Uses @tonejs/midi for parsing (synchronous, no nested worker issues).

import { Midi } from "@tonejs/midi";
import type { NoteEvent, TempoEvent, TimeSignatureEvent, MusicDocument, KeySignature, SustainRange } from "@bach-to-basics/shared";
import { midiToPitch } from "@bach-to-basics/shared";

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; id: string; title: string }>) => {
  const { buffer, id } = e.data;
  // L5 - strip control characters that could corrupt downstream metadata
  const title = e.data.title.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200);

  try {
    const midi = new Midi(buffer);
    const ppq = midi.header.ppq;

    // ── Tempo map ────────────────────────────────────────────────────────────
    const tempoMap: TempoEvent[] = midi.header.tempos.map((t) => ({
      tick: t.ticks,
      bpm: t.bpm,
    }));
    if (tempoMap.length === 0) tempoMap.push({ tick: 0, bpm: 120 });

    // ── Time signatures ──────────────────────────────────────────────────────
    const timeSignatures: TimeSignatureEvent[] = midi.header.timeSignatures.map((ts) => ({
      tick: ts.ticks,
      numerator: ts.timeSignature[0],
      denominator: ts.timeSignature[1],
    }));
    if (timeSignatures.length === 0) timeSignatures.push({ tick: 0, numerator: 4, denominator: 4 });

    // ── Key signature ────────────────────────────────────────────────────────
    // @tonejs/midi exposes header.keySignatures as { ticks, key, scale }[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawKeySigs: any[] = (midi.header as any).keySignatures ?? [];
    let keySignature: KeySignature | null = null;
    if (rawKeySigs.length > 0) {
      const first = rawKeySigs[0];
      // L5 - sanitize key field: allow only valid key-signature characters
      const rawKey = String(first.key ?? "C");
      const safeKey = rawKey.replace(/[^A-Ga-g#b]/g, "").slice(0, 3) || "C";
      keySignature = {
        key:   safeKey,
        scale: first.scale === "minor" ? "minor" : "major",
      };
    }

    // ── Note events ──────────────────────────────────────────────────────────
    const notes: NoteEvent[] = [];
    let idCounter = 0;

    for (let trackIdx = 0; trackIdx < midi.tracks.length; trackIdx++) {
      const track = midi.tracks[trackIdx];

      // Hand assignment by track: track 0 = right, track 1 = left (standard)
      let hand: NoteEvent["hand"] = "unknown";
      if (midi.tracks.length >= 2) {
        hand = trackIdx === 0 ? "right" : "left";
      }

      for (const note of track.notes) {
        notes.push({
          id: `n${idCounter++}`,
          midi: note.midi,
          pitch: midiToPitch(note.midi),
          startTick: note.ticks,
          durationTick: note.durationTicks,
          startSeconds: note.time,         // @tonejs/midi computes this
          endSeconds: note.time + note.duration,
          hand,
          finger: null,
          velocity: Math.round(note.velocity * 127),
          channel: 0,
        });
      }
    }

    notes.sort((a, b) => a.startSeconds - b.startSeconds);

    const totalDuration = notes.length > 0
      ? Math.max(...notes.map((n) => n.endSeconds))
      : 0;

    // ── Sustain pedal (CC64) to sustain ranges ───────────────────────────────
    // @tonejs/midi normalises CC values to 0-1; ≥0.5 means pedal is depressed.
    const sustainRanges: SustainRange[] = [];
    const allCC64: { time: number; value: number }[] = [];
    for (const track of midi.tracks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cc64: any[] = (track.controlChanges as any)[64] ?? [];
      for (const cc of cc64) {
        allCC64.push({ time: cc.time as number, value: cc.value as number });
      }
    }
    allCC64.sort((a, b) => a.time - b.time);

    let sustainStart: number | null = null;
    for (const cc of allCC64) {
      const isOn = cc.value >= 0.5;
      if (isOn && sustainStart === null) {
        sustainStart = cc.time;
      } else if (!isOn && sustainStart !== null) {
        sustainRanges.push({ startSeconds: sustainStart, endSeconds: cc.time });
        sustainStart = null;
      }
    }
    if (sustainStart !== null) {
      sustainRanges.push({ startSeconds: sustainStart, endSeconds: totalDuration });
    }

    const doc: MusicDocument = {
      id,
      title,
      sourceType: "midi",
      musicXml: null,
      midiBuffer: buffer,
      notes,
      tempoMap,
      timeSignatures,
      totalDuration,
      ppq,
      keySignature,
      youtubeId: null,
      youtubeSyncOffset: 0,
      fingeringVersion: "none",
      sustainRanges,
    };

    self.postMessage({ ok: true, doc });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
