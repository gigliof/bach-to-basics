"""
Basic Pitch service: audio (MP3/WAV/etc.) to MIDI via Spotify's Basic Pitch model.

Requires Python 3.11 or 3.12 due to tensorflow-macos constraints.
See requirements-transcribe.txt for setup instructions.
"""
import asyncio
import tempfile
from pathlib import Path

_IMPORT_ERROR: str | None = None

try:
    from basic_pitch.inference import predict  # type: ignore
    from basic_pitch import ICASSP_2022_MODEL_PATH  # type: ignore
except ImportError as e:
    _IMPORT_ERROR = (
        "basic-pitch is not installed. MP3 transcription requires Python 3.11 or 3.12. "
        "See backend/requirements-transcribe.txt for setup instructions. "
        f"Original error: {e}"
    )


async def transcribe_audio_to_midi(audio_bytes: bytes, filename: str) -> bytes:
    """Transcribe audio bytes to MIDI bytes using Basic Pitch."""
    if _IMPORT_ERROR:
        raise RuntimeError(_IMPORT_ERROR)
    return await asyncio.get_running_loop().run_in_executor(
        None, _transcribe, audio_bytes, filename
    )


def _transcribe(audio_bytes: bytes, filename: str) -> bytes:
    suffix = Path(filename).suffix or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio_bytes)
        audio_path = f.name

    _model_output, midi_data, _note_events = predict(  # type: ignore[name-defined]
        audio_path, ICASSP_2022_MODEL_PATH  # type: ignore[name-defined]
    )

    midi_tmp = tempfile.NamedTemporaryFile(suffix=".mid", delete=False)
    midi_tmp.close()
    midi_data.write(midi_tmp.name)

    midi_bytes = Path(midi_tmp.name).read_bytes()
    Path(audio_path).unlink(missing_ok=True)
    Path(midi_tmp.name).unlink(missing_ok=True)
    return midi_bytes
