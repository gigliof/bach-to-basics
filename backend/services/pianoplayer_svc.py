"""
pianoplayer service: annotate MusicXML with fingering (Parncutt algorithm).

Note: defusedxml.defuse_stdlib() is called in main.py before this module
is imported, so xml.etree (used by music21 internally) is already patched.
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
    from pianoplayer.hand import RightHand, LeftHand
    import music21

    xml_path = None
    out_tmp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".xml", delete=False, mode="w", encoding="utf-8"
        ) as f:
            f.write(musicxml)
            xml_path = f.name

        score = music21.converter.parse(xml_path)

        # pianoplayer works on individual parts
        for part in score.parts:
            notes = list(part.flatten().notes)
            if not notes:
                continue

            # Determine left / right hand by average register
            avg_pitch = sum(
                n.pitch.midi for n in notes if hasattr(n, "pitch")
            ) / max(len(notes), 1)
            hand_cls = RightHand if avg_pitch >= 60 else LeftHand

            try:
                hand = hand_cls(score, 0)
                hand.autodepth = False
                hand.verbose = False
                hand.generate(part=part.id if hasattr(part, "id") else 0)
            except Exception:
                pass  # pianoplayer can fail on complex scores; skip gracefully

        out_tmp = tempfile.NamedTemporaryFile(suffix=".xml", delete=False)
        out_tmp.close()
        out_tmp_name = out_tmp.name
        score.write("musicxml", fp=out_tmp_name)

        return Path(out_tmp_name).read_text(encoding="utf-8")

    finally:
        if xml_path:
            Path(xml_path).unlink(missing_ok=True)
        if out_tmp_name:
            Path(out_tmp_name).unlink(missing_ok=True)
