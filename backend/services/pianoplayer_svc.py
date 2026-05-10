"""
pianoplayer service: annotate MusicXML with fingering (Parncutt algorithm).

Uses the pianoplayer v3 API (run_annotate) which handles part routing and
hand assignment internally.
"""
import asyncio
import os
import tempfile
from pathlib import Path

# Configurable via env var; default 120 s is generous for complex scores.
_FINGERING_TIMEOUT = int(os.environ.get("FINGERING_TIMEOUT_S", "120"))


async def annotate_fingering(musicxml: str) -> str:
    """Add finger annotations to MusicXML using the pianoplayer library."""
    try:
        return await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, _annotate, musicxml),
            timeout=_FINGERING_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise RuntimeError(
            "Fingering generation timed out. "
            "Try a shorter score or increase FINGERING_TIMEOUT_S."
        )


def _annotate(musicxml: str) -> str:
    import io
    import contextlib
    from pianoplayer.core import run_annotate

    xml_path = None
    out_path = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".xml", delete=False, mode="w", encoding="utf-8"
        ) as f:
            f.write(musicxml)
            xml_path = f.name

        out_tmp = tempfile.NamedTemporaryFile(suffix=".xml", delete=False)
        out_tmp.close()
        out_path = out_tmp.name

        # Suppress Rich progress/summary output so server logs stay clean.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            run_annotate(
                xml_path,
                outputfile=out_path,
                n_measures=1000,
                auto_routing=True,  # let pianoplayer detect which part is L/R
                quiet=True,
            )

        return Path(out_path).read_text(encoding="utf-8")

    finally:
        if xml_path:
            Path(xml_path).unlink(missing_ok=True)
        if out_path:
            Path(out_path).unlink(missing_ok=True)
