# web-shell domain

Owns the browser-side React shell for Lucifer.

- `repository/` performs browser fetches.
- `service/` exposes UI-facing use cases.
- `types/` validates the `/api/health` contract.
- `ui/` renders the health status card.

This domain is intentionally narrow today: it shows platform health and starter
copy, while the command approval workflow currently lives in the backend's web
approval surface.
