# Platform Health

## Purpose

Expose a minimal platform status contract for runtime checks and diagnostics.

## Server Contract

- Endpoint: `GET /api/health`
- Shape:
  - `environment`
  - `name`
  - `nodeVersion`
  - `status`
  - `timestamp`

## Current Scope

- This endpoint is used for platform verification and tests.
- The main operator UI is the backend-served admin approval page at
  `/admin/approvals`.
