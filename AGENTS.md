# IMONSOFT Files — implementation contract

## Product
A self-hosted, white-label file utility product. Russian UI. Prioritize PPT/PPTX to PDF,
PDF to PPTX (explicitly image-based), useful PDF operations, and image workflows.
Never label screenshots embedded in PPTX as editable slide reconstruction.
Never show an unavailable engine as working or fake progress/completions.

## Architecture
- React + TypeScript + Vite in `apps/web`; shared catalog `shared/tools.json`.
- FastAPI in `services/api`; SQLite job metadata; private per-job directories.
- Every conversion runs in a separate killable subprocess; no concurrent PDFium threads.
- Gotenberg is an internal Office-to-PDF adapter, never a public endpoint.
- Deployment is Docker Compose behind nginx, bound to loopback by default.

## Development
Run backend tests before changing converters. Test real output bytes, not just status 200.
Run TypeScript/build and browser tests for UI changes. Keep lockfiles committed.
Do not commit uploads, credentials, private documents, font binaries, generated results,
node_modules, local .env files, or recordings.

## Design
Use the tokens and components already present. No gradients, unrelated icon sets,
placeholder dashboards, fake users, fake metrics, or arbitrary extra CTAs.
All grid edges, focus states, errors, mobile controls and dark theme must be checked.

## Security and honesty
Respect upload limits, session ownership, expiry and cancellation. Never shell-interpolate
user filenames. Never claim a lossless optimizer will always reduce PDF size.
Public anonymous hosting requires a separate security deployment review.
Do not change the license of this project's own code without the owner's decision.
