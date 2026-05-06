"""
/youtube/extract - Download audio from YouTube URL, transcribe to MIDI
"""
import logging
import os
import re
import shutil
import tempfile

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# C1 - validate video IDs: exactly 11 URL-safe chars
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


class YoutubeExtractRequest(BaseModel):
    url: str


@router.post("/extract")
async def youtube_extract(req: YoutubeExtractRequest, background_tasks: BackgroundTasks):
    """Download best audio from YouTube, run Basic Pitch, return MIDI."""
    # C1 - extract video ID from user URL, reconstruct a safe canonical URL.
    # The raw req.url is NEVER forwarded to yt-dlp (SSRF prevention).
    match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", req.url)
    if not match or not _VIDEO_ID_RE.match(match.group(1)):
        raise HTTPException(status_code=422, detail="Invalid or unsupported YouTube URL")

    video_id = match.group(1)
    safe_url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        from services.ytdlp import download_audio
        from services.basic_pitch import transcribe_audio_to_midi

        audio_path, audio_tmpdir = await download_audio(safe_url)
        # H5 - register audio dir cleanup immediately so it runs even if
        # transcription fails (don't wait until after the whole try block).
        background_tasks.add_task(_rm_dir, audio_tmpdir)

        midi_bytes = await transcribe_audio_to_midi(
            audio_path.read_bytes(), audio_path.name
        )

        # H5 - write MIDI to a named temp file; register cleanup in background
        tmp = tempfile.NamedTemporaryFile(suffix=".mid", delete=False)
        tmp.write(midi_bytes)
        tmp.close()
        background_tasks.add_task(_rm_file, tmp.name)

        # L2 - no-store so the browser never caches the MIDI file
        return FileResponse(
            tmp.name,
            media_type="audio/midi",
            filename=f"{video_id}.mid",
            headers={
                "X-Video-Id": video_id,
                "Cache-Control": "no-store",
                "Content-Disposition": f'attachment; filename="{video_id}.mid"',
            },
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("youtube_extract failed for video_id=%s", video_id)
        raise HTTPException(
            status_code=500,
            detail="Audio extraction failed. Please try again.",
        )


# ── Cleanup helpers ───────────────────────────────────────────────────────────

def _rm_file(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _rm_dir(path: str) -> None:
    try:
        shutil.rmtree(path)
    except OSError as e:
        logger.warning("Failed to remove temp directory %s: %s", path, e)
