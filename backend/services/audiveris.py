"""
Audiveris service: PDF/image to MusicXML via Audiveris.

Audiveris is detected automatically in three locations (in order):
  1. backend/bin/audiveris.jar  - legacy standalone JAR (any platform)
  2. /Applications/Audiveris.app - macOS DMG install
  3. `audiveris` in PATH        - Linux .deb / Windows .msi install

Get Audiveris at: https://github.com/Audiveris/audiveris/releases
Requires Java 17+ (already present on this machine).
"""
import asyncio
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

# ── Audiveris binary detection ────────────────────────────────────────────────

_LEGACY_JAR = Path(__file__).parent.parent / "bin" / "audiveris.jar"

_MACOS_APP_BIN = Path("/Applications/Audiveris.app/Contents/MacOS/Audiveris")


def _find_audiveris() -> list[str] | None:
    """Return the command prefix to invoke Audiveris, or None if not found.

    Checked in order:
      1. backend/bin/audiveris.jar  (legacy standalone JAR)
      2. /Applications/Audiveris.app  (macOS DMG install)
      3. `audiveris` in PATH  (Linux deb / Windows msi)
    """
    if _LEGACY_JAR.exists():
        return ["java", "-jar", str(_LEGACY_JAR)]
    if _MACOS_APP_BIN.exists():
        return [str(_MACOS_APP_BIN)]
    if shutil.which("audiveris"):
        return ["audiveris"]
    return None


# ── Timeouts (configurable via env vars) ──────────────────────────────────────

# Audiveris: typically 30-120 s per page; set higher for very large scores.
AUDIVERIS_TIMEOUT = int(os.environ.get("AUDIVERIS_TIMEOUT_S", "120"))

# H4 - extension allowlist (defence-in-depth; routers also enforce this)
_ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif"}


# ── Public async entry points ─────────────────────────────────────────────────

async def pdf_to_musicxml(file_bytes: bytes, suffix: str = ".pdf") -> str:
    """Run Audiveris OMR on a PDF or image, returns MusicXML string."""
    return await asyncio.get_running_loop().run_in_executor(
        None, _run_audiveris, file_bytes, suffix
    )


async def pdf_to_musicxml_and_midi(
    file_bytes: bytes, suffix: str = ".pdf"
) -> tuple[str, bytes]:
    """OMR to MusicXML, then to MIDI.

    Runs both steps in a single thread-pool task (both are blocking) to
    avoid two executor round-trips and to keep the intermediate MusicXML
    in memory rather than writing it back over the wire.

    Returns:
        (musicxml_str, midi_bytes)
    """
    return await asyncio.get_running_loop().run_in_executor(
        None, _run_omr_and_convert, file_bytes, suffix
    )


# ── Combined OMR + MIDI conversion (blocking, runs in thread pool) ───────────

def _run_omr_and_convert(file_bytes: bytes, suffix: str) -> tuple[str, bytes]:
    musicxml = _run_audiveris(file_bytes, suffix)
    # Import the private sync helper directly to avoid a second executor call.
    from services.music21_svc import _xml_to_midi  # noqa: PLC0415
    midi_bytes = _xml_to_midi(musicxml.encode("utf-8"), "score.xml")
    return musicxml, midi_bytes


# ── Audiveris (primary engine) ────────────────────────────────────────────────

def _run_audiveris(file_bytes: bytes, suffix: str) -> str:
    # H4 - validate suffix even if caller skips router-level check
    if suffix.lower() not in _ALLOWED_SUFFIXES:
        raise ValueError(f"Unsupported file type: {suffix!r}")

    cmd_prefix = _find_audiveris()
    if cmd_prefix is None:
        # T3-2: generic message for the API consumer; full setup details are
        # logged server-side only to avoid leaking OS/path information.
        import logging as _log
        _log.getLogger(__name__).error(
            "Audiveris not found. Checked: %s, %s, PATH",
            _LEGACY_JAR, _MACOS_APP_BIN,
        )
        raise RuntimeError("OMR engine is not available on this server")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = Path(tmpdir) / f"input{suffix}"
        input_path.write_bytes(file_bytes)
        output_dir = Path(tmpdir) / "output"
        output_dir.mkdir()

        result = subprocess.run(
            cmd_prefix + [
                "-batch",
                "-export",
                "-output", str(output_dir),
                "--", str(input_path),
            ],
            capture_output=True,
            timeout=AUDIVERIS_TIMEOUT,
        )

        if result.returncode != 0:
            # H3 - don't leak internal tool output in API response
            raise RuntimeError("Audiveris OMR processing failed")

        xml_files = list(output_dir.rglob("*.mxl")) + list(output_dir.rglob("*.xml"))
        if not xml_files:
            raise RuntimeError(
                "Audiveris produced no MusicXML output. "
                "The PDF may be a text document or a poor-quality scan."
            )

        result_path = xml_files[0]
        if result_path.suffix.lower() == ".mxl":
            # .mxl is a ZIP-compressed MusicXML - extract the main XML entry
            import posixpath
            import zipfile

            def _safe_member(name: str) -> bool:
                """Reject ZIP entry names with path traversal sequences."""
                return not posixpath.normpath(name).startswith("..")

            # T1-2: decompressed-size cap to defend against ZIP bombs.
            # Don't trust ZipInfo.file_size (headers can lie); enforce
            # the limit during actual streaming decompression.
            MAX_DECOMPRESSED = 50 * 1024 * 1024  # 50 MB

            with zipfile.ZipFile(result_path) as zf:
                # META-INF/container.xml lists the root file; fall back to first .xml
                names = zf.namelist()
                root_file = next(
                    (
                        n for n in names
                        if n.endswith(".xml")
                        and not n.startswith("META-INF")
                        and _safe_member(n)
                    ),
                    next(
                        (n for n in names if n.endswith(".xml") and _safe_member(n)),
                        None,
                    ),
                )
                if root_file is None:
                    raise RuntimeError("Audiveris .mxl archive contains no XML entry")

                # Stream-read with size enforcement (T1-2)
                with zf.open(root_file) as entry:
                    chunks: list[bytes] = []
                    total = 0
                    while True:
                        chunk = entry.read(65_536)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_DECOMPRESSED:
                            raise ValueError(
                                "Decompressed MusicXML exceeds 50 MB, possible ZIP bomb"
                            )
                        chunks.append(chunk)
                    return b"".join(chunks).decode("utf-8")
        else:
            return result_path.read_text(encoding="utf-8")
