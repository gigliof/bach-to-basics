"""
/transcribe/midi2musicxml  - MIDI to MusicXML via music21
/transcribe/musicxml2midi  - MusicXML to MIDI via music21
/transcribe/mp3            - MP3 to MIDI via Basic Pitch (Spotify)
"""
import logging
import os
import re
import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse

logger = logging.getLogger(__name__)
router = APIRouter()

# C2 - file size cap
MAX_UPLOAD_BYTES = 50 * 1024 * 1024   # 50 MB

# H4 - extension allowlists
_MIDI_EXTS  = {".mid", ".midi"}
_XML_EXTS   = {".xml", ".mxl"}
_AUDIO_EXTS = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"}

# M5 - MIDI magic bytes: "MThd"
_MIDI_MAGIC = b"MThd"


# ── Shared guards ─────────────────────────────────────────────────────────────

async def _read_with_limit(file: UploadFile, max_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    """Stream-read upload in 64 KB chunks; reject as soon as total exceeds limit.

    Unlike ``await file.read()`` followed by a size check, this never buffers
    an arbitrarily large payload into memory (H2: memory-DoS prevention).
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(65_536)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail="Upload too large (max 50 MB)")
        chunks.append(chunk)
    return b"".join(chunks)


def _check_ext(filename: str, allowed: set[str]) -> None:
    ext = Path(filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(allowed))}",
        )


def _check_midi_magic(data: bytes) -> None:
    if not data.startswith(_MIDI_MAGIC):
        raise HTTPException(status_code=422, detail="Not a valid MIDI file")


def _safe_title(raw: str) -> str:
    """M2 - strip control chars and cap length.
    HTML-escaping for XML embedding is done by music21_svc, not here,
    to avoid double-escaping (&amp;amp; etc.)."""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", raw)
    return cleaned[:200]


def _rm(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/midi2musicxml")
async def midi_to_musicxml(file: UploadFile, title: str = Query(default="")):
    """Convert a MIDI file to MusicXML for sheet music rendering."""
    try:
        _check_ext(file.filename or "track.mid", _MIDI_EXTS)
        data = await _read_with_limit(file)
        _check_midi_magic(data)

        from services.music21_svc import midi_bytes_to_musicxml
        safe_title = _safe_title(title)
        musicxml = await midi_bytes_to_musicxml(data, title=safe_title)

        # L2 - prevent caching of user data
        return JSONResponse({"musicxml": musicxml}, headers={"Cache-Control": "no-store"})
    except HTTPException:
        raise
    except Exception:
        logger.exception("midi_to_musicxml failed")
        raise HTTPException(status_code=500, detail="Conversion failed. Please try again.")


@router.post("/musicxml2midi")
async def musicxml_to_midi(file: UploadFile, background_tasks: BackgroundTasks):
    """Convert a MusicXML (.xml or .mxl) file to MIDI for playback."""
    try:
        filename = file.filename or "score.xml"
        _check_ext(filename, _XML_EXTS)
        data = await _read_with_limit(file)

        from services.music21_svc import musicxml_bytes_to_midi
        midi_bytes = await musicxml_bytes_to_midi(data, filename)

        tmp = tempfile.NamedTemporaryFile(suffix=".mid", delete=False)
        tmp.write(midi_bytes)
        tmp.close()
        background_tasks.add_task(_rm, tmp.name)   # H5

        return FileResponse(
            tmp.name,
            media_type="audio/midi",
            filename="score.mid",
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": 'attachment; filename="score.mid"',
            },
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("musicxml_to_midi failed")
        raise HTTPException(status_code=500, detail="Conversion failed. Please try again.")


@router.post("/mp3")
async def transcribe_mp3(file: UploadFile, background_tasks: BackgroundTasks):
    """Transcribe an MP3/audio file to MIDI using Basic Pitch."""
    try:
        _check_ext(file.filename or "audio.mp3", _AUDIO_EXTS)
        data = await _read_with_limit(file)

        from services.basic_pitch import transcribe_audio_to_midi
        midi_bytes = await transcribe_audio_to_midi(data, file.filename or "audio.mp3")

        tmp = tempfile.NamedTemporaryFile(suffix=".mid", delete=False)
        tmp.write(midi_bytes)
        tmp.close()
        background_tasks.add_task(_rm, tmp.name)   # H5

        return FileResponse(
            tmp.name,
            media_type="audio/midi",
            filename="transcribed.mid",
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": 'attachment; filename="transcribed.mid"',
            },
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("transcribe_mp3 failed")
        raise HTTPException(status_code=500, detail="Transcription failed. Please try again.")
