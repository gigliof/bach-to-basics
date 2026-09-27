import type { Input, NoteMessageEvent } from "webmidi";

/** Keeps selection and owned note listeners in sync with physical MIDI ports. */
export class MidiInputSelection {
  private inputs: Input[] = [];
  private selected: Input | null = null;
  private suppressed = new Set<string>();
  private heldNotes = new Set<number>();

  constructor(private readonly callbacks: {
    changed: (inputs: Input[], selected: Input | null) => void;
    noteOn: (note: number, velocity: number) => void;
    noteOff: (note: number) => void;
  }) {}

  refresh(inputs: Input[]) {
    this.inputs = inputs.filter((input) => input.state === "connected");
    for (const id of this.suppressed) {
      if (!this.inputs.some((input) => input.id === id)) this.suppressed.delete(id);
    }
    const next = this.selected && this.inputs.includes(this.selected)
      ? this.selected
      : this.inputs.find((input) => !this.suppressed.has(input.id)) ?? null;
    this.change(next);
  }

  select(id: string) {
    const input = this.inputs.find((input) => input.id === id);
    if (!input) return;
    this.suppressed.delete(id);
    this.change(input);
  }

  disconnect() {
    // An explicit Disconnect stays disconnected until a new device arrives
    // or the user picks one; output-port events must not undo that choice.
    this.suppressed = new Set(this.inputs.map((input) => input.id));
    this.change(null);
  }

  dispose() {
    this.detach();
    this.inputs = [];
    this.callbacks.changed([], null);
  }

  private noteOn = (event: NoteMessageEvent) => {
    this.heldNotes.add(event.note.number);
    this.callbacks.noteOn(event.note.number, event.rawValue ?? 64);
  };

  private noteOff = (event: NoteMessageEvent) => {
    this.heldNotes.delete(event.note.number);
    this.callbacks.noteOff(event.note.number);
  };

  private detach() {
    this.selected?.removeListener("noteon", this.noteOn);
    this.selected?.removeListener("noteoff", this.noteOff);
    for (const note of this.heldNotes) this.callbacks.noteOff(note);
    this.heldNotes.clear();
    this.selected = null;
  }

  private change(input: Input | null) {
    if (input !== this.selected) {
      this.detach();
      this.selected = input;
      input?.addListener("noteon", this.noteOn);
      input?.addListener("noteoff", this.noteOff);
    }
    this.callbacks.changed(this.inputs, this.selected);
  }
}
