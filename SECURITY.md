# Security Policy

## Scope

Bach to Basics handles no user accounts, no personal data, and no financial information. It is a local music practice tool — the main attack surface is **file processing** (MIDI, MusicXML, PDF uploads) and the **FastAPI backend** when self-hosted.

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
3. Fill in the details — steps to reproduce, impact, any suggested fix

You'll get a response within a few days. There's no formal embargo policy given the nature of this project, but please give a reasonable heads-up before going public.
