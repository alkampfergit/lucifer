# platform-api domain

Owns the platform-facing Express surface and bootstrap seams for Lucifer.

- `config/` parses server runtime settings such as port and environment.
- `repository/` provides runtime metadata used by health reporting.
- `service/` builds the `/api/health` response.
- `api/` registers the health endpoint.

The top-level server composition happens in `server/src/create_app.ts`, which
assembles `platform-api` with `command-gateway` without creating direct
cross-domain imports between their internals.
