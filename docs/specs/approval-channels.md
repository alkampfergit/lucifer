# Approval Channels

## Purpose

Resolve `manual_approve` command requests through a common approval contract.

## Available Channels

### Telegram

- Enabled when `LUCIFER_TELEGRAM_TOKEN` and a chat ID are available.
- Sends inline keyboard buttons for exact or prefix approval durations.
- Stores approvals in SQLite.

### Web Admin

- Enabled when `adminSecretHash` and `adminSecretSalt` are both present in `lucifer.json` (written by `--init`).
- Serves `/admin/approvals`.
- Uses bearer auth for admin APIs, with an optional cookie session (below).
- Streams pending requests over SSE.
- Stores approvals in SQLite.
- The page is served from `approval_page.html`, which the build copies next to the
  compiled module. Startup fails if that asset is missing — an unreachable UI on
  the only configured channel means no request can ever be approved.

#### Admin cookie sessions

On by default; disable with `"adminCookieSession": { "enabled": false }` in
`lucifer.json`, which unregisters the `/session` routes entirely.

- `POST /api/v1/admin/approvals/session` exchanges the admin bearer secret for
  two cookies. It accepts **only** bearer auth: minting from an existing cookie
  would make the lifetime sliding.
  - `lucifer_admin` — `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`.
    Holds `v1.<iv>.<ciphertext>.<tag>` (base64url), an AES-256-GCM sealed
    assertion `{ v, sub, iat, exp, csrf }`. Self-contained: no server-side
    session table, and sessions survive a restart.
  - `lucifer_admin_csrf` — same lifetime and flags but **not** `HttpOnly`, so
    the page can read it.
  - `Secure` is added only when the request arrived over https (directly or via
    `X-Forwarded-Proto`), so plain `http://localhost:3001` still receives the
    cookies.
- `DELETE /api/v1/admin/approvals/session` signs out by expiring both cookies.
- **Lifetime**: 30 days, absolute. `exp` is sealed in the cookie and never
  extended; cookie `Max-Age` matches, so browser and server expire together.
- **Payload**: a session assertion, never the admin secret. A leaked sealing key
  therefore yields a forgeable, expiring session rather than a reusable bearer
  credential — and there is no scrypt verification per request.
- **Authentication order**: an `Authorization` header is treated as a deliberate
  bearer attempt and decided on its own, so curl/CLI behaviour and the per-IP
  lockout are unchanged. The cookie is consulted only when no bearer header was
  sent. An expired, tampered, or foreign-key cookie falls through to the same
  `401 UNAUTHORIZED` + lockout path as a wrong secret.
- **CSRF**: cookie-authenticated callers must echo the `lucifer_admin_csrf`
  value in an `X-Lucifer-CSRF` header on every state-changing route
  (`POST …/:requestId/decide`, `POST …/stream-ticket`, `DELETE …/session`). The
  header is compared with `timingSafeEqual` against the `csrf` claim sealed
  *inside* the cookie, so an attacker who can only set cookies still fails.
  Mismatch or absence → `403 CSRF_INVALID`, which deliberately does **not**
  count toward the auth lockout. Bearer callers skip the check entirely.
  `SameSite=Strict` stays as defence in depth. `GET` routes are read-only and
  are not CSRF-gated; the SSE stream keeps its existing short-lived ticket, and
  the ticket-minting `POST` is gated.
- **Sealing key**: `LUCIFER_ADMIN_COOKIE_KEY` → OS keychain (optional
  `@napi-rs/keyring`) → `server_secrets` table in `lucifer.db`. See
  [../CONFIGURATION.md](../CONFIGURATION.md#admin-cookie-sessions).

### Auto-Approve

- Enabled by CLI flag `--auto-approve`.
- Intended for local development only.

### Multi-Channel

- Used when Telegram and web admin are both enabled.
- The first decision wins.
- Losing channels are cancelled for that request.

## Approval Shapes

- Match types: `once`, `exact`, `prefix`
- Durations: `0` (once), `2`, `8`, `permanent`

## Stored Approval Behavior

- **Once** approvals execute the command but do not store anything — the next identical command will require approval again.
- **Exact** approvals match the full command string.
- **Prefix** approvals match the derived first two tokens of the command.
- Cached approvals are checked before prompting a human.
