# Platform Health

## Purpose

Expose a minimal platform status contract and render it in the browser shell.

## Server Contract

- Endpoint: `GET /api/health`
- Shape:
  - `environment`
  - `name`
  - `nodeVersion`
  - `status`
  - `timestamp`

## Browser Behavior

- The React app fetches `/api/health` on load.
- The response is validated with a type guard before rendering.
- The UI shows loading, error, and success states.

## Current Scope

- This is the only React-managed backend contract today.
- The main approval workflow is not part of `web-shell`; it lives in backend
  routes and the server-delivered admin approval page.
