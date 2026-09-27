# Bach to Basics for Mac

Open **Bach to Basics.app** in the release folder. You can move the app to Applications; the music backend and web assets are inside the bundle. No Node, Python, Terminal, or running development server is needed.

Imported files are copied into a persistent local song library. Use **Songs** in the header to search and switch between imports or import another song. The last selected song reopens at launch. Reimporting identical contents does not create a duplicate. Files imported before version 0.6.2 need to be imported once more to enter the library.

Use **File → Open Music…** (⌘O), the Import button, or drag a MIDI or MusicXML file into the window. Finder's Open With also works for MIDI/MusicXML. The first available MIDI keyboard is selected automatically at launch or when connected. Use the MIDI button to choose another input or disconnect manually. If the selected keyboard is unplugged, another available input is selected automatically. The volume button after L/R opens two vertical hand-volume sliders. Hands are linked by default: either slider changes both volumes. Turn off Link hands to adjust them independently. The L/R mute buttons remain separate. Space starts/pauses playback. Click Loop to open its range editor: drag the A and B handles to set start/end, use arrow keys for 0.1-second adjustments, choose Whole song, or Turn loop off. A/B buttons still set endpoints at the playback position. Each song remembers its own loop range. Export uses a Mac save dialog. Quit with ⌘Q to stop the music service; closing the window leaves the app running in the Dock.

The interface, demo MIDI, notation soundfont, music21 conversions, and fingering engine are bundled. Instrument samples are fetched from the original app's online sound libraries, so internet access is needed for those sounds. MIDI hardware and speaker output must be checked on your own equipment.

Optional PDF recognition (Audiveris), PDF typesetting (LilyPond), audio transcription (Basic Pitch), and FFmpeg are not bundled. Their existing controls remain available but require their optional engines. Installing Basic Pitch into the old backend virtual environment does not add it to this frozen app; that requires rebuilding the backend with compatible dependencies.

This build targets Apple Silicon Macs running macOS 26 or later and is locally ad-hoc signed. It is not Developer ID signed or notarized for public distribution. Third-party licenses are retained in the bundle's Resources directory and the Electron framework.

## Rebuild

From the project root (Node/pnpm and Python are needed only to build):

```sh
pnpm install --frozen-lockfile
python3 -m venv desktop/.venv
desktop/.venv/bin/python -m pip install -r desktop/requirements-build.lock
npm ci --prefix desktop
npm run build --prefix desktop
```

The build compiles the frontend, freezes Python dependencies with PyInstaller, packages Electron, creates a piano-key icon, and ad-hoc signs the bundle. The build targets the current Mac architecture; this delivered build is arm64.

## Diagnostics and validation

Help → Show Diagnostic Log opens the backend log. The app starts the service on a random loopback port with a per-launch secret. The renderer runs isolated, and only the bundled app origin receives MIDI permissions. Backend processes are stopped when the app quits.

The automated desktop smoke check is invoked by setting `BACH_SMOKE_OUTPUT` to an absolute JSON output path when launching the app executable. It checks backend authentication, MIDI/MusicXML conversion, fingering, desktop file import, sheet rendering, Web MIDI availability, and captures the app window to a PNG alongside the report.

Preferences are saved automatically, including appearance, layout, hand volumes and linking, muted hands, instrument, practice options, tempo, and wait mode. Reopening the app restores these preferences and the last song; playback starts stopped. Reset settings saves the restored defaults.

Drag the top edge of the piano keys to resize the keyboard vertically, up to one-third of the window height. The chosen height is saved automatically. Focus the resize edge and use Up/Down arrows (Shift for larger steps), Home for minimum, or End for maximum. Double-click the top edge to restore its default height.
