"""
music21 service: MIDI to MusicXML, MusicXML to PDF

Note: defusedxml.defuse_stdlib() is called in main.py before this module
is imported, so xml.etree (used by music21 internally) is already patched.
"""
import asyncio
import concurrent.futures
import html
import logging
import os
import re
import tempfile
from collections.abc import Callable
from pathlib import Path

logger = logging.getLogger(__name__)

# T1-3: Dedicated process pool for music21 operations.
#
# Why ProcessPoolExecutor instead of ThreadPoolExecutor:
#   Threads can't be forcibly killed when asyncio.wait_for fires; the
#   timed-out thread keeps consuming CPU/memory until it naturally ends,
#   occupying one of the two worker slots indefinitely.  A separate OS
#   process can be terminated, so a timed-out worker actually frees its slot.
#
# max_workers=2 caps concurrency so pathologically complex scores can't
# starve all other endpoints.  Functions must be module-level (picklable),
# which they already are (_convert, _xml_to_midi, _to_pdf take only
# bytes/str arguments and return bytes/str).
#
# Initializer: On macOS / Linux with "spawn" start method each worker is a
# fresh process, defusedxml patches from main.py are NOT inherited.
# _music21_worker_init() re-applies them so XXE protection is active in
# every worker.


def _music21_worker_init() -> None:
    """Apply XML security patches in each worker process (spawn-safe)."""
    import defusedxml as _defusedxml
    _defusedxml.defuse_stdlib()
    try:
        from lxml import etree as _lxml_etree  # type: ignore

        _orig = _lxml_etree.XMLParser.__init__

        def _safe_init(self, *args, **kwargs):
            kwargs.setdefault("resolve_entities", False)
            kwargs.setdefault("no_network", True)
            _orig(self, *args, **kwargs)

        _lxml_etree.XMLParser.__init__ = _safe_init
    except ImportError:
        pass  # lxml not installed, nothing to patch


_music21_executor = concurrent.futures.ProcessPoolExecutor(
    max_workers=2,
    initializer=_music21_worker_init,
)
_MUSIC21_TIMEOUT = int(os.environ.get("MUSIC21_TIMEOUT_S", "60"))


async def _run_in_music21_pool(fn: Callable, *args) -> object:
    """Run a blocking music21 function in the dedicated pool with a hard timeout."""
    try:
        return await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(_music21_executor, fn, *args),
            timeout=_MUSIC21_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise RuntimeError(
            "Processing timed out, the score may be too complex. "
            "Try a simpler file or increase MUSIC21_TIMEOUT_S."
        )


async def midi_bytes_to_musicxml(midi_bytes: bytes, title: str = "") -> str:
    """Convert MIDI binary to MusicXML string using music21."""
    return await _run_in_music21_pool(_convert, midi_bytes, title)


def _convert(midi_bytes: bytes, title: str = "") -> str:  # noqa: C901
    import music21
    from music21 import tempo as m21tempo

    midi_path = None
    xml_tmp_name = None
    try:
        # H5 - track paths so finally block can always clean up
        with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
            f.write(midi_bytes)
            midi_path = f.name

        score = music21.converter.parse(midi_path)

        # Quantize to 16th-note grid + triplets - eliminates exotic tuplets
        try:
            score = score.quantize(
                quarterLengthDivisors=(4, 3),
                processOffsets=True,
                processDurations=True,
                inPlace=False,
            )
        except Exception as e:
            logger.warning("Score quantization skipped: %s", e)

        # Strip excessive MetronomeMark objects from rubato performances
        try:
            all_marks = list(score.recurse().getElementsByClass("MetronomeMark"))
            primary_bpm = round(all_marks[0].number) if all_marks else 120

            for mark in all_marks:
                if mark.activeSite is not None:
                    try:
                        mark.activeSite.remove(mark)
                    except Exception:
                        pass  # mark already detached or activeSite stale

            try:
                first_part = score.parts[0]
                measures = first_part.getElementsByClass("Measure")
                if measures:
                    first_measure = list(measures)[0]
                    mm = m21tempo.MetronomeMark(number=primary_bpm)
                    first_measure.insert(0, mm)
            except Exception as e:
                logger.warning("Could not insert primary tempo mark: %s", e)
        except Exception as e:
            logger.warning("Tempo cleanup skipped: %s", e)

        # Set score title, sanitize to prevent XML injection
        try:
            from music21 import metadata as m21meta
            if score.metadata is None:
                score.metadata = m21meta.Metadata()
            safe_title = html.escape(title[:200]) if title else "Untitled"
            score.metadata.title = safe_title
        except Exception as e:
            logger.warning("Could not set score title: %s", e)

        # Split into treble/bass staves for proper piano rendering
        score = _apply_piano_split(score)

        xml_tmp = tempfile.NamedTemporaryFile(suffix=".xml", delete=False)
        xml_tmp.close()
        xml_tmp_name = xml_tmp.name
        score.write("musicxml", fp=xml_tmp_name)

        xml = Path(xml_tmp_name).read_text(encoding="utf-8")

        # Strip music21-generated boilerplate that clutters the score display
        xml = re.sub(r'\s*<creator\b[^>]*>[^<]*</creator>\s*\n?', '\n    ', xml)
        xml = re.sub(r'\s*<movement-title\b[^>]*>[^<]*</movement-title>\s*\n?', '\n  ', xml)
        return xml

    finally:
        if midi_path:
            Path(midi_path).unlink(missing_ok=True)
        if xml_tmp_name:
            Path(xml_tmp_name).unlink(missing_ok=True)


def _apply_piano_split(score):  # noqa: C901
    """Rewrite a MIDI-derived score as a proper piano grand staff.

    Grand-staff piano in MusicXML must be ONE part with TWO staves
    (staves>2</staves>, per-note <staff> tags, <backup> elements).
    music21 achieves this via PartStaff + StaffGroup - which is what
    AlphaTab needs to render treble + bass clef linked by a brace.

    Strategy:
    • Single-part score: split notes at C4 (MIDI 60) into treble/bass PartStaff.
    • Multi-part score: treat the two highest-/lowest-pitched parts as
                           treble/bass and link them the same way.
    """
    import copy
    from music21 import clef as m21clef, instrument as m21inst, layout as m21layout
    from music21 import note as m21note, chord as m21chord
    from music21 import stream as m21s

    parts = list(score.parts)
    if not parts:
        return score

    SPLIT = 60  # Middle C - notes >= C4 go treble, < C4 go bass

    def _avg_pitch(part):
        pitches = []
        for n in part.flatten().notes:
            if hasattr(n, "pitches"):
                pitches.extend(p.midi for p in n.pitches)
            elif hasattr(n, "pitch"):
                pitches.append(n.pitch.midi)
        return sum(pitches) / len(pitches) if pitches else 60

    # ── Build two PartStaff streams ──────────────────────────────────────────
    treble_staff = m21s.PartStaff()
    bass_staff   = m21s.PartStaff()
    treble_staff.insert(0, m21inst.Piano())
    bass_staff.insert(0, m21inst.Piano())

    def _has_pitched_content(m):
        """Return True if the Measure contains at least one Note, Rest, or Chord
        at the top level OR nested inside Voice containers."""
        if any(isinstance(e, (m21note.Note, m21note.Rest, m21chord.Chord)) for e in m):
            return True
        # Also check inside Voice containers
        from music21 import stream as _m21s
        for e in m:
            if isinstance(e, _m21s.Voice):
                if any(isinstance(v, (m21note.Note, m21note.Rest, m21chord.Chord)) for v in e):
                    return True
        return False

    if len(parts) == 1:
        # Single-track MIDI: distribute notes by pitch while preserving Voice
        # structure.
        #
        # Key design points:
        #   1. Preserve Voice containers. Game/sequencer MIDIs nest notes inside
        #      Voice sub-streams. If we flatten and re-insert notes at the same
        #      offset into a plain Measure, music21 writes them SEQUENTIALLY
        #      (note A dur=2 + note B dur=0.5 = 2.5 beats consumed), inflating
        #      <backup> values and breaking AlphaTab's cursor tracker.
        #      Keeping Voice containers tells music21 that those notes are
        #      concurrent, so it emits correct <backup> values between voices.
        #   2. Structural elements (TimeSignature, KeySignature, TempoIndication)
        #      go to the TREBLE staff only - putting them in both staves causes
        #      music21 to emit doubled <time>/<key> attributes.
        #   3. Pad each staff to barDuration with a single trailing rest so the
        #      MusicXML <backup> value always equals the measure length exactly.
        from music21 import meter as m21meter, key as m21key, tempo as m21tempo

        def _dist_note(el, t_dest, b_dest):
            """Distribute a single Note or Chord between treble/bass targets."""
            if isinstance(el, m21note.Note):
                dest = t_dest if el.pitch.midi >= SPLIT else b_dest
                dest.insert(el.offset, copy.deepcopy(el))
            elif isinstance(el, m21chord.Chord):
                t_notes = [n for n in el.notes if n.pitch.midi >= SPLIT]
                b_notes = [n for n in el.notes if n.pitch.midi < SPLIT]
                if t_notes:
                    c = m21chord.Chord([copy.deepcopy(n) for n in t_notes])
                    c.duration = copy.deepcopy(el.duration)
                    t_dest.insert(el.offset, c)
                if b_notes:
                    c = m21chord.Chord([copy.deepcopy(n) for n in b_notes])
                    c.duration = copy.deepcopy(el.duration)
                    b_dest.insert(el.offset, c)

        source = parts[0]
        for meas in source.getElementsByClass("Measure"):
            t_meas = m21s.Measure(number=meas.number)
            b_meas = m21s.Measure(number=meas.number)

            # ── Structural / non-pitched elements: treble only ───────────────
            for el in meas:
                if isinstance(el, (m21meter.TimeSignature,
                                   m21key.KeySignature,
                                   m21tempo.TempoIndication)):
                    t_meas.insert(el.offset, copy.deepcopy(el))
                # Clefs are assigned separately below; instruments already set.

            # ── Pitched content: preserve Voice containers ────────────────────
            # Walk top-level elements. Voice containers are kept intact so that
            # music21 writes concurrent notes correctly in MusicXML.
            for el in meas:
                if isinstance(el, m21s.Voice):
                    t_voice = m21s.Voice()
                    b_voice = m21s.Voice()
                    for sub in el:
                        _dist_note(sub, t_voice, b_voice)
                    if any(True for _ in t_voice):
                        t_meas.insert(el.offset, t_voice)
                    if any(True for _ in b_voice):
                        b_meas.insert(el.offset, b_voice)
                elif isinstance(el, (m21note.Note, m21chord.Chord)):
                    _dist_note(el, t_meas, b_meas)
                # Rests at top level are skipped; padding is added below.

            # ── Pad each staff to barDuration with a single trailing rest ─────
            # This ensures highestTime == barDuration so music21 emits the
            # correct <backup> value when writing the combined grand-staff part.
            bar_ql = meas.barDuration.quarterLength
            for staff_meas in (t_meas, b_meas):
                ht = staff_meas.highestTime
                if ht < bar_ql - 0.001:
                    pad = m21note.Rest()
                    pad.duration.quarterLength = bar_ql - ht
                    staff_meas.append(pad)

            treble_staff.append(t_meas)
            bass_staff.append(b_meas)

    else:
        # Multi-track MIDI: pick the two parts with highest/lowest avg pitch
        sorted_parts = sorted(parts, key=_avg_pitch, reverse=True)
        treble_src, bass_src = sorted_parts[0], sorted_parts[-1]
        for src, dest in [(treble_src, treble_staff), (bass_src, bass_staff)]:
            for meas in src.getElementsByClass("Measure"):
                dest.append(copy.deepcopy(meas))

    # ── Assign clefs to first measure of each PartStaff ─────────────────────
    for staff, clef_obj in [
        (treble_staff, m21clef.TrebleClef()),
        (bass_staff,   m21clef.BassClef()),
    ]:
        measures = list(staff.getElementsByClass("Measure"))
        if measures:
            first_m = measures[0]
            for c in list(first_m.getElementsByClass("Clef")):
                first_m.remove(c)
            first_m.insert(0, clef_obj)

    # ── Assemble score with brace StaffGroup (= grand staff) ─────────────────
    new_score = m21s.Score()
    if score.metadata:
        new_score.metadata = score.metadata
    new_score.insert(0, treble_staff)
    new_score.insert(0, bass_staff)

    # StaffGroup with symbol='brace' tells MusicXML consumers (AlphaTab)
    # that these two PartStaffs are a single piano grand staff.
    staff_group = m21layout.StaffGroup(
        [treble_staff, bass_staff],
        name="Piano",
        abbreviation="Pno.",
        symbol="brace",
    )
    new_score.insert(0, staff_group)

    return new_score


async def musicxml_bytes_to_midi(xml_bytes: bytes, filename: str = "score.xml") -> bytes:
    """Convert MusicXML (.xml or .mxl) bytes to MIDI bytes using music21."""
    return await _run_in_music21_pool(_xml_to_midi, xml_bytes, filename)


def _xml_to_midi(xml_bytes: bytes, filename: str) -> bytes:
    import music21

    suffix = ".mxl" if filename.lower().endswith(".mxl") else ".xml"
    xml_path = None
    midi_tmp_name = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(xml_bytes)
            xml_path = f.name

        score = music21.converter.parse(xml_path)

        midi_tmp = tempfile.NamedTemporaryFile(suffix=".mid", delete=False)
        midi_tmp.close()
        midi_tmp_name = midi_tmp.name
        score.write("midi", fp=midi_tmp_name)

        return Path(midi_tmp_name).read_bytes()

    finally:
        if xml_path:
            Path(xml_path).unlink(missing_ok=True)
        if midi_tmp_name:
            Path(midi_tmp_name).unlink(missing_ok=True)


async def musicxml_to_pdf(musicxml: str) -> str:
    """Render MusicXML to PDF using music21 + LilyPond. Returns path to PDF file."""
    return await _run_in_music21_pool(_to_pdf, musicxml)


def _to_pdf(musicxml: str) -> str:
    import music21
    import shutil
    import subprocess

    xml_path = None
    ly_path = None
    pdf_tmp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".xml", delete=False, mode="w", encoding="utf-8"
        ) as f:
            f.write(musicxml)
            xml_path = f.name

        score = music21.converter.parse(xml_path)

        # M2: Generate LilyPond source via music21, then invoke lilypond
        # manually with a restricted environment.  This prevents a crafted
        # score from exfiltrating env vars or touching the filesystem via
        # LilyPond's embedded Scheme interpreter.
        ly_tmp = tempfile.NamedTemporaryFile(suffix=".ly", delete=False)
        ly_tmp.close()
        ly_path = ly_tmp.name
        score.write("lily", fp=ly_path)

        lilypond_bin = shutil.which("lilypond")
        if not lilypond_bin:
            raise RuntimeError(
                "LilyPond not found in PATH. PDF export requires LilyPond.\n"
                "  macOS: brew install lilypond\n"
                "  Linux: apt install lilypond"
            )

        pdf_tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        pdf_tmp.close()
        pdf_tmp_name = pdf_tmp.name
        # LilyPond appends .pdf to the -o basename, so strip the extension
        pdf_base = pdf_tmp_name[:-4]

        # Minimal environment: only PATH, HOME, and LilyPond/Guile paths
        safe_env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/usr/local/bin"),
            "HOME": os.environ.get("HOME", "/tmp"),
        }
        for key in ("GUILE_LOAD_PATH", "GUILE_LOAD_COMPILED_PATH", "LILYPOND_DATADIR"):
            if key in os.environ:
                safe_env[key] = os.environ[key]

        result = subprocess.run(
            [lilypond_bin, "--pdf", "-dno-point-and-click", "-o", pdf_base, ly_path],
            capture_output=True,
            timeout=60,
            env=safe_env,
        )

        if result.returncode != 0 or not Path(pdf_tmp_name).exists():
            logger.error("LilyPond failed: %s", result.stderr.decode(errors="replace")[:500])
            raise RuntimeError("LilyPond PDF rendering failed")

        # Caller (export_routes) owns cleanup via BackgroundTask
        pdf_tmp_name = None   # transfer ownership, don't clean up in finally
        return pdf_tmp.name

    finally:
        if xml_path:
            Path(xml_path).unlink(missing_ok=True)
        if ly_path:
            Path(ly_path).unlink(missing_ok=True)
        # Clean up PDF temp only if we still own it (i.e. render raised)
        if pdf_tmp_name:
            Path(pdf_tmp_name).unlink(missing_ok=True)
