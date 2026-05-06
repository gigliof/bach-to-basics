# Contributing to Bach to Basics

Thanks for your interest! This guide covers the practical bits of working on the codebase.

## Quick start (development)

```bash
pnpm install
pnpm backend:setup       # creates backend/.venv with the core deps
pnpm dev                 # starts frontend (5173) + backend (8000) concurrently
```

## Project layout

- `frontend/`: React 19 + Vite + TypeScript app
  - `src/components/`: UI components, organised by feature
  - `src/engine/`: `SyncEngine`, `AudioEngine`, MIDI clock (no React inside)
  - `src/store/`: Zustand state
  - `src/views/`: top-level layouts (`PracticeView`)
- `backend/`: FastAPI app
  - `routers/`: endpoint groups (`transcribe`, `omr`, `youtube`, `export_routes`, `fingering`)
  - `services/`: long-running blocking work, run in dedicated executors with timeouts
- `shared/`: TypeScript types used by the frontend (the backend has its own duplicates intentionally, keeps backend deployable independently)

## Conventions

- **TypeScript strict mode** is on. `pnpm --filter frontend exec tsc --noEmit` should pass cleanly.
- **No `any` without a comment** explaining why.
- **All audio-engine work happens off the React tree.** The `SyncEngine` is a singleton that emits events on a `mitt` bus; views subscribe via `useEffect`.
- **Backend services are blocking-by-default** and wrapped in `_run_in_*_pool()` helpers with hard timeouts. Don't add long-running CPU work directly in route handlers.

## Before opening a PR

1. `pnpm --filter frontend exec tsc --noEmit`: type check
2. `pnpm test`: frontend unit tests
3. If you touched the backend: `cd backend && python -m py_compile $(find . -name "*.py" -not -path "./.venv/*")`
4. Verify the dev server still boots cleanly (`pnpm dev`)

## Reporting bugs

Include:
- Browser + OS version
- Whether you're running via `pnpm dev` or Docker
- Steps to reproduce
- Anything in the browser console (DevTools > Console) and the backend terminal

## Security

Found a vulnerability? Please don't open a public issue. Reach out via the contact info on the repo owner's GitHub profile.
