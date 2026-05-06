"""
yt-dlp service: download best audio from a YouTube URL.

Returns (audio_path, tmpdir) - the caller is responsible for cleaning up
tmpdir (e.g. via a BackgroundTask) after the audio data has been consumed.
"""
import asyncio
import subprocess
import tempfile
from pathlib import Path


async def download_audio(url: str) -> tuple[Path, str]:
    """Download best audio track from YouTube URL.

    Returns:
        (mp3_path, tmpdir) - tmpdir must be deleted by the caller.
    """
    return await asyncio.get_running_loop().run_in_executor(None, _download, url)


def _download(url: str) -> tuple[Path, str]:
    tmpdir = tempfile.mkdtemp()
    output_template = str(Path(tmpdir) / "audio.%(ext)s")

    result = subprocess.run(
        [
            "yt-dlp",
            "--format", "bestaudio/best",
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--output", output_template,
            "--no-playlist",
            # Cap download size: a 30-min piano recording at high quality is ~50 MB;
            # 200 MB gives ample headroom while guarding against 24-hour streams
            # that would exhaust disk space before the 300 s timeout fires.
            "--max-filesize", "200m",
            url,          # already a safe canonical URL from the router
        ],
        capture_output=True,
        timeout=300,
    )

    if result.returncode != 0:
        # Don't leak yt-dlp stderr in the API response; log it server-side
        import logging
        logging.getLogger(__name__).error(
            "yt-dlp failed (exit %d): %s",
            result.returncode,
            result.stderr.decode(errors="replace")[:500],
        )
        raise RuntimeError("Audio download failed")

    mp3_files = list(Path(tmpdir).glob("*.mp3"))
    if not mp3_files:
        raise RuntimeError("Audio download produced no output")

    return mp3_files[0], tmpdir
