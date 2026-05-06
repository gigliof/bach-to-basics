import asyncio
import hmac
import logging
import os
import shutil
import time
from collections import defaultdict
from contextlib import asynccontextmanager

# M1 - Patch stdlib XML parsers before any other import uses them.
# defuse_stdlib() replaces xml.etree.ElementTree, xml.dom.minidom, etc.
# with safe equivalents that reject XXE / XML-bomb payloads.
import defusedxml
defusedxml.defuse_stdlib()

# H1 - Patch lxml's default XMLParser to disable entity resolution and
# network access.  defuse_stdlib() only covers stdlib xml.etree; music21
# may use lxml internally if it is installed.
try:
    from lxml import etree as _lxml_etree

    _orig_xmlparser_init = _lxml_etree.XMLParser.__init__

    def _safe_xmlparser_init(self, *args, **kwargs):
        kwargs.setdefault("resolve_entities", False)
        kwargs.setdefault("no_network", True)
        _orig_xmlparser_init(self, *args, **kwargs)

    _lxml_etree.XMLParser.__init__ = _safe_xmlparser_init
except ImportError:
    pass  # lxml not installed, nothing to patch

from fastapi import Depends, FastAPI, HTTPException, Request, Response, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from routers import export_routes, fingering, omr, transcribe, youtube

logging.basicConfig(level=logging.WARNING)

# ── H1: Optional API-key authentication ──────────────────────────────────────
# Set BACKEND_API_KEY env-var to enable.  When the var is absent the guard is
# a no-op so local dev works without any extra config.
_API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)

_auth_warned = False


def _require_api_key(key: str | None = Security(_API_KEY_HEADER)) -> None:
    global _auth_warned
    expected = os.environ.get("BACKEND_API_KEY")
    # T1-1: only treat *absent* key (None) as "auth disabled".
    # An empty string means a deployment misconfiguration, not "no auth".
    if expected is None:
        if not _auth_warned:
            logging.warning(
                "BACKEND_API_KEY is not set - all API endpoints are unauthenticated. "
                "Set this env var in production."
            )
            _auth_warned = True
        return  # auth genuinely not configured (dev mode)
    if not expected:
        # Empty string = broken deployment config; reject loudly
        raise HTTPException(status_code=500, detail="Server authentication misconfigured")
    # T2-2: constant-time comparison prevents timing-based key extraction
    if not hmac.compare_digest(key or "", expected):
        raise HTTPException(status_code=403, detail="Forbidden")


# ── Startup checks ────────────────────────────────────────────────────────────

def _startup_checks() -> None:
    """Log warnings for optional external binaries that are absent at launch."""
    # M1: fail fast if auth is explicitly required but no key is configured
    if os.environ.get("REQUIRE_AUTH", "").strip().lower() in ("1", "true", "yes"):
        if not os.environ.get("BACKEND_API_KEY"):
            raise SystemExit(
                "FATAL: REQUIRE_AUTH is set but BACKEND_API_KEY is empty. "
                "Set BACKEND_API_KEY or unset REQUIRE_AUTH."
            )

    checks = [
        ("ffmpeg",   "needed for /export/mp3"),
        ("yt-dlp",   "needed for /youtube/extract"),
    ]
    for binary, purpose in checks:
        if not shutil.which(binary):
            logging.warning("Optional binary not found: %s (%s)", binary, purpose)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    _startup_checks()
    yield


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Bach to Basics",
    version="0.1.0",
    dependencies=[Depends(_require_api_key)],
    lifespan=_lifespan,
)

# H2 / L1 - CORS: read allowed origins from ALLOWED_ORIGINS env var
# (comma-separated list of URLs).  Defaults to the Vite dev server so local
# development works without any extra config.
#
# Production example:
#   ALLOWED_ORIGINS=https://myapp.example.com
#   ALLOWED_ORIGINS=https://myapp.example.com,https://www.myapp.example.com
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
)

# ── Security-headers middleware ───────────────────────────────────────────────

@app.middleware("http")
async def _add_security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    # Prevent MIME-type sniffing
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    # Prevent the API from being embedded in iframes (clickjacking)
    response.headers.setdefault("X-Frame-Options", "DENY")
    # Don't send the Referer header to third parties
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    # Disable browser features this API doesn't need
    response.headers.setdefault(
        "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
    )
    # T4-2: HSTS: enforce HTTPS for 2 years (Web MIDI requires HTTPS anyway)
    response.headers.setdefault(
        "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
    )
    return response


# ── Per-IP rate limiter (no extra dependencies) ───────────────────────────────
# Caps requests per IP in a rolling 60-second window.
# Set RATE_LIMIT_PER_MIN=0 to disable (e.g. when sitting behind your own
# reverse proxy that already handles rate limiting).

_rate_window: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT = int(os.environ.get("RATE_LIMIT_PER_MIN", "60"))

# L4: stricter limit for expensive endpoints (OMR, YouTube)
_HEAVY_RATE_LIMIT = int(os.environ.get("HEAVY_RATE_LIMIT_PER_MIN", "10"))
_HEAVY_PREFIXES = ("/omr/", "/youtube/")

# M3: periodic sweep of stale entries to prevent unbounded memory growth
_last_sweep = 0.0
_SWEEP_INTERVAL = 300.0  # 5 minutes

# T4-3: hard cap on tracked IPs to prevent memory growth from botnet drip attacks
_MAX_RATE_ENTRIES = 50_000

# T2-1: asyncio.Lock prevents TOCTOU race in concurrent async handlers
_rate_lock = asyncio.Lock()

# M4: proxy-aware IP resolution: when the request arrives from a trusted
# proxy, use X-Forwarded-For instead of request.client.host.
# Set TRUSTED_PROXY_IPS=10.0.0.1,10.0.0.2 to enable.
_TRUSTED_PROXIES = {
    ip.strip()
    for ip in os.environ.get("TRUSTED_PROXY_IPS", "").split(",")
    if ip.strip()
}


def _get_client_ip(request: Request) -> str:
    """Resolve client IP, respecting X-Forwarded-For from trusted proxies."""
    direct_ip = request.client.host if request.client else "unknown"
    if _TRUSTED_PROXIES and direct_ip in _TRUSTED_PROXIES:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            # Rightmost IP not in trusted proxies = last non-proxy hop
            for ip in reversed(forwarded.split(",")):
                ip = ip.strip()
                if ip and ip not in _TRUSTED_PROXIES:
                    return ip
    return direct_ip


def _sweep_stale_entries(now: float) -> None:
    """Remove IPs with no requests in the last 2 minutes (M3).

    Also enforces a hard cap on total tracked IPs (T4-3) to prevent
    slow-drip memory growth from botnets.
    Must be called while holding _rate_lock.
    """
    global _last_sweep
    if now - _last_sweep < _SWEEP_INTERVAL:
        return
    _last_sweep = now
    stale = [ip for ip, ts in _rate_window.items() if not ts or now - ts[-1] > 120.0]
    for ip in stale:
        del _rate_window[ip]
    # T4-3: evict oldest entries if still over the hard cap
    while len(_rate_window) > _MAX_RATE_ENTRIES:
        oldest = min(_rate_window, key=lambda k: _rate_window[k][-1] if _rate_window[k] else 0)
        del _rate_window[oldest]


@app.middleware("http")
async def _rate_limit(request: Request, call_next) -> Response:
    # Skip the health probe and CORS preflight requests.
    if request.url.path == "/health" or request.method == "OPTIONS":
        return await call_next(request)

    if _RATE_LIMIT > 0:
        ip = _get_client_ip(request)
        now = time.monotonic()

        # T2-1: lock the read-check-write cycle so concurrent async
        # handlers can't all pass the limit check simultaneously
        async with _rate_lock:
            _sweep_stale_entries(now)

            # L4: apply stricter limit for heavy endpoints
            limit = _RATE_LIMIT
            if any(request.url.path.startswith(p) for p in _HEAVY_PREFIXES):
                limit = _HEAVY_RATE_LIMIT

            # Prune timestamps outside the rolling window
            window = [t for t in _rate_window[ip] if now - t < 60.0]
            if len(window) >= limit:
                return Response(
                    content='{"detail":"Too many requests - please wait a moment."}',
                    status_code=429,
                    media_type="application/json",
                    headers={"Retry-After": "60"},
                )
            window.append(now)
            _rate_window[ip] = window

    return await call_next(request)


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(transcribe.router,    prefix="/transcribe", tags=["transcribe"])
app.include_router(omr.router,           prefix="/omr",        tags=["omr"])
app.include_router(youtube.router,       prefix="/youtube",    tags=["youtube"])
app.include_router(fingering.router,     prefix="/fingering",  tags=["fingering"])
app.include_router(export_routes.router, prefix="/export",     tags=["export"])


@app.get("/health")
async def health():
    return {"status": "ok"}
