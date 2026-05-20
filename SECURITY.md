# Security Policy

## Scope

Bach to Basics handles no user accounts, no personal data, and no financial information. It is a local music practice tool - the main attack surface is **file processing** (MIDI, MusicXML, PDF uploads) and the **FastAPI backend** when self-hosted.

## Threat model

Bach to Basics is designed primarily for **personal self-hosting** - running on `localhost` or your home network for solo practice. Anything beyond that is a "you opted in" scenario that requires extra configuration (see the README's "Public deployments" section).

**In scope** for hardening and reports:

- Input-validation flaws in any file-upload endpoint (MIDI, MusicXML, PDF, audio)
- XXE, XML-bomb, or ZIP-bomb attacks via MusicXML / `.mxl`
- Command injection in subprocess invocations (LilyPond, Audiveris, ffmpeg, yt-dlp, pianoplayer)
- SSRF on the `/youtube/extract` endpoint
- Path-traversal via uploaded filenames or response Content-Disposition
- API-key authentication bypasses or timing attacks
- CSP, CORS, or security-header regressions on the frontend
- Service-worker cache leaks of `/api/*` responses (PWA)

**Out of scope:**

- Multi-tenant user isolation - the app has no concept of users
- Persistent server-side storage hardening - the backend stores nothing beyond ephemeral request-scoped tempfiles
- Distributed-denial-of-service protection beyond the simple per-IP rate limit - use a reverse proxy or CDN for serious traffic
- Vulnerabilities inside third-party optional binaries the user installs themselves (LilyPond, Audiveris JAR, Basic Pitch / TensorFlow, yt-dlp) - report those upstream
- Browser-extension or operating-system-level threats (keyloggers, screen capture, etc.)

## What to report

Worth reporting privately:

- Remote code execution or sandbox escape via a crafted MIDI, MusicXML, or PDF file
- Server-side vulnerabilities in the FastAPI backend (path traversal, SSRF, etc.)
- Dependency vulnerabilities with a realistic exploit path

Probably not a security issue (open a regular bug instead):

- Unexpected UI behaviour caused by a malformed music file
- The app crashing or producing wrong output from bad input

## Reporting

Use **GitHub's private vulnerability reporting**:

1. Go to the [Security tab](https://github.com/gigliof/bach-to-basics/security) of this repo
2. Click **"Report a vulnerability"**
3. Fill in the details - steps to reproduce, impact, any suggested fix

Reports are handled by a single maintainer in personal time, so response times vary.
