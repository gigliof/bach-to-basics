import os
import sys
from pathlib import Path

import pytest

# Must be set before main.py is imported: these are read at import time.
os.environ.setdefault("RATE_LIMIT_PER_MIN", "0")
os.environ.pop("BACKEND_API_KEY", None)
os.environ.pop("REQUIRE_AUTH", None)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("BACKEND_API_KEY", raising=False)
    monkeypatch.delenv("REQUIRE_AUTH", raising=False)
    with TestClient(main.app) as c:
        yield c


def note_xml(step: str, octave: int, alter: int = 0) -> str:
    alt = f"<alter>{alter}</alter>" if alter else ""
    return (
        f"<note><pitch><step>{step}</step>{alt}<octave>{octave}</octave></pitch>"
        "<duration>1</duration><type>quarter</type></note>"
    )


def score_xml(*measures: str, harmony: str = "") -> str:
    """Minimal single-part MusicXML. Each measure is a string of <note> elements."""
    body = "".join(
        f'<measure number="{i + 1}">'
        + (
            "<attributes><divisions>1</divisions><key><fifths>0</fifths></key>"
            "<time><beats>4</beats><beat-type>4</beat-type></time>"
            "<clef><sign>G</sign><line>2</line></clef></attributes>"
            if i == 0
            else ""
        )
        + (harmony if i == 0 else "")
        + m
        + "</measure>"
        for i, m in enumerate(measures)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<score-partwise version="4.0">'
        '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
        f'<part id="P1">{body}</part></score-partwise>'
    )


def midi_pitches(midi_bytes: bytes) -> list[int]:
    """Sorted MIDI pitches of every note-on in a MIDI file."""
    from music21 import midi

    mf = midi.MidiFile()
    mf.readstr(midi_bytes)
    return sorted(
        e.pitch
        for t in mf.tracks
        for e in t.events
        if e.type == midi.ChannelVoiceMessages.NOTE_ON and e.velocity > 0
    )
