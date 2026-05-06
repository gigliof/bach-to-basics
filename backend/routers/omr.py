"""
/omr/pdf   - PDF sheet music to MusicXML via Audiveris
/omr/image - Image (PNG/JPG) sheet music to MusicXML via Audiveris
"""
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
router = APIRouter()

# C2 - file size cap
MAX_UPLOAD_BYTES = 50 * 1024 * 1024   # 50 MB

# H4 - extension allowlists
_PDF_EXTS   = {".pdf"}
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tiff", ".tif"}

# M5 - magic bytes
_PDF_MAGIC  = b"%PDF"
_PNG_MAGIC  = b"\x89PNG"
_JPEG_MAGIC = b"\xff\xd8\xff"
_TIFF_MAGIC = (b"II*\x00", b"MM\x00*")


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


def _check_pdf_magic(data: bytes) -> None:
    if not data.startswith(_PDF_MAGIC):
        raise HTTPException(status_code=422, detail="Not a valid PDF file")


def _check_image_magic(data: bytes, ext: str) -> None:
    if ext in {".png"} and not data.startswith(_PNG_MAGIC):
        raise HTTPException(status_code=422, detail="Not a valid PNG file")
    if ext in {".jpg", ".jpeg"} and not data.startswith(_JPEG_MAGIC):
        raise HTTPException(status_code=422, detail="Not a valid JPEG file")
    if ext in {".tiff", ".tif"} and not any(data.startswith(m) for m in _TIFF_MAGIC):
        raise HTTPException(status_code=422, detail="Not a valid TIFF file")


@router.post("/pdf")
async def omr_pdf(file: UploadFile):
    """Run OMR on a PDF sheet music file to MusicXML."""
    try:
        _check_ext(file.filename or "score.pdf", _PDF_EXTS)
        data = await _read_with_limit(file)
        _check_pdf_magic(data)

        from services.audiveris import pdf_to_musicxml
        musicxml = await pdf_to_musicxml(data, suffix=".pdf")
        return JSONResponse({"musicxml": musicxml}, headers={"Cache-Control": "no-store"})
    except HTTPException:
        raise
    except Exception:
        logger.exception("omr_pdf failed")
        raise HTTPException(status_code=500, detail="OMR processing failed. Please try again.")


@router.post("/image")
async def omr_image(file: UploadFile):
    """Run OMR on an image (PNG/JPG) of sheet music to MusicXML."""
    try:
        filename = file.filename or "image.png"
        _check_ext(filename, _IMAGE_EXTS)
        data = await _read_with_limit(file)
        ext = Path(filename).suffix.lower()
        _check_image_magic(data, ext)

        from services.audiveris import pdf_to_musicxml
        musicxml = await pdf_to_musicxml(data, suffix=ext)
        return JSONResponse({"musicxml": musicxml}, headers={"Cache-Control": "no-store"})
    except HTTPException:
        raise
    except Exception:
        logger.exception("omr_image failed")
        raise HTTPException(status_code=500, detail="OMR processing failed. Please try again.")


@router.post("/pdf2midi")
async def omr_pdf_to_midi(file: UploadFile):
    """PDF sheet music, OMR to MusicXML + MIDI in one round-trip.

    Returns JSON: { musicxml: str, midi_b64: str, filename: str }
    Both artifacts arrive together so the frontend can render sheet music
    AND enable playback without a second network request.
    """
    import base64

    try:
        _check_ext(file.filename or "score.pdf", _PDF_EXTS)
        data = await _read_with_limit(file)
        _check_pdf_magic(data)

        from services.audiveris import pdf_to_musicxml_and_midi
        musicxml, midi_bytes = await pdf_to_musicxml_and_midi(data, suffix=".pdf")
        midi_b64 = base64.b64encode(midi_bytes).decode("ascii")

        return JSONResponse(
            {"musicxml": musicxml, "midi_b64": midi_b64, "filename": "score.mid"},
            headers={"Cache-Control": "no-store"},
        )

    except HTTPException:
        raise
    except RuntimeError as exc:
        # User-safe messages from audiveris.py (no JAR, no output, etc.)
        logger.warning("omr_pdf_to_midi: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:
        logger.exception("omr_pdf_to_midi failed unexpectedly")
        raise HTTPException(status_code=500, detail="PDF processing failed. Please try again.")
