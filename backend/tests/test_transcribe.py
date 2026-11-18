"""MusicXML <-> MIDI conversion endpoints (music21)."""
import io
import zipfile

import pytest

from tests.conftest import midi_pitches, note_xml, score_xml

SCALE = score_xml(
    "".join(note_xml(s, 4) for s in "CDEF"),
    "".join(note_xml(s, 4) for s in "GAB") + note_xml("C", 5),
)
SCALE_PITCHES = [60, 62, 64, 65, 67, 69, 71, 72]


def to_midi(client, data: bytes, filename: str):
    return client.post("/transcribe/musicxml2midi", files={"file": (filename, data)})


@pytest.mark.parametrize("filename", ["score.xml", "score.musicxml", "SCORE.MusicXML"])
def test_musicxml_to_midi_accepts_xml_extensions(client, filename):
    r = to_midi(client, SCALE.encode(), filename)
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"MThd")
    assert midi_pitches(r.content) == SCALE_PITCHES


def test_musicxml_to_midi_accepts_compressed_mxl(client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container><rootfiles>'
            '<rootfile full-path="score.xml"/></rootfiles></container>',
        )
        z.writestr("score.xml", SCALE)
    r = to_midi(client, buf.getvalue(), "score.mxl")
    assert r.status_code == 200, r.text
    assert midi_pitches(r.content) == SCALE_PITCHES


@pytest.mark.parametrize("filename", ["score.txt", "score.pdf", "score"])
def test_musicxml_to_midi_rejects_other_extensions(client, filename):
    assert to_midi(client, SCALE.encode(), filename).status_code == 422


def test_chord_symbols_do_not_become_notes(client):
    # A "C" chord-symbol label over a single written note must not add C-E-G
    harmony = "<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>"
    xml = score_xml(note_xml("A", 4) * 4, harmony=harmony)
    r = to_midi(client, xml.encode(), "lead.musicxml")
    assert r.status_code == 200, r.text
    assert midi_pitches(r.content) == [69, 69, 69, 69]


def test_real_chords_are_kept(client):
    chord = (
        note_xml("C", 4)
        + note_xml("E", 4).replace("<note>", "<note><chord/>")
        + note_xml("G", 4).replace("<note>", "<note><chord/>")
    )
    xml = score_xml(chord + note_xml("C", 4) * 3)
    r = to_midi(client, xml.encode(), "chords.xml")
    assert r.status_code == 200, r.text
    assert midi_pitches(r.content) == [60, 60, 60, 60, 64, 67]


def test_malformed_musicxml_is_a_clean_500(client):
    r = to_midi(client, b"<score-partwise><oops", "bad.xml")
    assert r.status_code == 500
    assert r.json()["detail"] == "Conversion failed. Please try again."


def test_xml_external_entities_are_not_resolved(client, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("TOPSECRET")
    xxe = (
        '<?xml version="1.0"?>'
        f'<!DOCTYPE x [<!ENTITY e SYSTEM "file://{secret}">]>'
        "<score-partwise><work><work-title>&e;</work-title></work></score-partwise>"
    )
    r = to_midi(client, xxe.encode(), "xxe.xml")
    assert r.status_code == 500  # refused, not parsed
    assert b"TOPSECRET" not in r.content
    # Regression: the refusal used to kill the worker pool, breaking every
    # later conversion until a restart
    assert to_midi(client, SCALE.encode(), "after.xml").status_code == 200


def test_pool_recovers_after_a_worker_dies(client):
    import asyncio
    import os

    from services import music21_svc

    with pytest.raises(RuntimeError, match="try again"):
        asyncio.run(music21_svc._run_in_music21_pool(os._exit, 1))
    assert to_midi(client, SCALE.encode(), "after.xml").status_code == 200


def test_midi_to_musicxml_round_trip_and_piano_split(client):
    # One part spanning both hands: the backend splits it onto a grand staff at middle C
    xml = score_xml(note_xml("C", 3) + note_xml("G", 3) + note_xml("E", 5) + note_xml("G", 5))
    midi = to_midi(client, xml.encode(), "both.xml").content
    r = client.post(
        "/transcribe/midi2musicxml",
        params={"title": "Round <trip>"},
        files={"file": ("both.mid", midi)},
    )
    assert r.status_code == 200, r.text
    out = r.json()["musicxml"]
    assert "<score-partwise" in out
    assert "Round &lt;trip&gt;" in out or "Round &amp;lt;trip&amp;gt;" in out
    assert "<sign>G</sign>" in out and "<sign>F</sign>" in out  # treble + bass clefs
    for step, octave in [("C", 3), ("G", 3), ("E", 5), ("G", 5)]:
        assert f"<step>{step}</step>" in out and f"<octave>{octave}</octave>" in out


def test_midi_to_musicxml_rejects_non_midi(client):
    r = client.post("/transcribe/midi2musicxml", files={"file": ("fake.mid", b"not midi")})
    assert r.status_code == 422
    r = client.post("/transcribe/midi2musicxml", files={"file": ("x.wav", b"MThd")})
    assert r.status_code == 422


def test_upload_size_cap(client, monkeypatch):
    from routers import transcribe

    monkeypatch.setattr(transcribe, "MAX_UPLOAD_BYTES", 10)
    # default arg was bound at def time, so patch the reader's default too
    monkeypatch.setattr(transcribe._read_with_limit, "__defaults__", (10,))
    r = to_midi(client, SCALE.encode(), "big.xml")
    assert r.status_code == 413
