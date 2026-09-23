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
    assertion `{ v, sub, aud, iat, exp, csrf }`. Self-contained: no server-side
    session table, and sessions survive a restart.
  - `lucifer_admin_csrf` — same lifetime and flags but **not** `HttpOnly`, so
    the page can read it.
  - `Secure` is added only when Express reports the request as secure
    (`req.secure`), so plain `http://localhost:3001` still receives the cookies.
    `X-Forwarded-Proto` is honoured only when the operator has set `trustProxy`
    in `lucifer.json`; untrusted, a client could otherwise claim TLS and be
    handed a `Secure` cookie its browser can never send back.
- `DELETE /api/v1/admin/approvals/session` signs out by expiring both cookies.
- **Lifetime**: 30 days, absolute. `exp` is sealed in the cookie and never
  extended; cookie `Max-Age` matches, so browser and server expire together.
- **Payload**: a session assertion, never the admin secret. A leaked sealing key
  therefore yields a forgeable, expiring session rather than a reusable bearer
  credential — and there is no scrypt verification per request.
- **Claim validation**: opening a cookie checks more than the GCM tag. `iat` and
  `exp` must be safe integers, `iat` may not be more than 60 seconds in the
  future (clock-skew tolerance), `exp` must be in the future, and `exp - iat`
  may not exceed the configured TTL, and `aud` must equal this deployment's
  identifier. Without the cap, anything able to seal a payload could mint a
  practically non-expiring session, which would void the "compromise yields only
  an expiring session" guarantee above.
- **Authentication order**: an `Authorization` header is treated as a deliberate
  bearer attempt and decided on its own, so curl/CLI behaviour and the per-IP
  lockout are unchanged. The cookie is consulted only when no bearer header was
  sent. An expired, tampered, foreign-key, or foreign-instance cookie falls
  through to the same `401 UNAUTHORIZED` + lockout path as a wrong secret. The
  lockout is keyed on `req.ip`, which Express resolves through the configured
  `trustProxy` policy — a direct client cannot rotate `X-Forwarded-For` to mint
  a fresh identity per guess.
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
- **Deployment scoping**: every instance derives an identifier from the absolute
  path of its `lucifer.db`. It names the keychain entry that holds the sealing
  key (`lucifer-gate` / `admin_session_key:<id>`) and is sealed into the `aud`
  claim. Two instances on one host share an OS account and — since browsers do
  not scope cookies by port — a cookie jar, so without this a session minted
  against one admin secret would authenticate against the other. Instances that
  share a `dataDir` share an identifier, which is correct: they are one
  deployment. Note that the identifier is derived, not configurable, and that
  two instances on the same host still overwrite each other's cookies in the
  browser; the effect is being signed out of one, never signed into the wrong
  one.
- **Sealing key**: `LUCIFER_ADMIN_COOKIE_KEY` → OS keychain (optional
  `@napi-rs/keyring`, pinned to the Secret Service on Linux so a host without
  one falls through rather than landing in the volatile kernel keyring) →
  `server_secrets` table in `lucifer.db`, whose file and WAL sidecars are set to
  mode `0600` on POSIX — Windows has no POSIX mode, so there the database keeps
  the ACL it inherits from `dataDir`. Only the keychain entry is scoped by instance; an operator who
  names one `LUCIFER_ADMIN_COOKIE_KEY` for several instances is naming one key
  on purpose, and the `aud` claim keeps their sessions apart regardless. A
  malformed `LUCIFER_ADMIN_COOKIE_KEY` is a startup error; every
  other resolution failure degrades to the next step. See
  [../CONFIGURATION.md](../CONFIGURATION.md#admin-cookie-sessions).
- **Auto-login probe**: the page probes `/pending` on load only when the
  readable `lucifer_admin_csrf` companion cookie is present. A blind probe would
  spend a real login attempt per visit and trip the per-IP lockout after five
  reloads made before signing in. A probe that fails clears the stale marker so
  reloading does not keep retrying; a `429` leaves it alone, since a lockout is
  not evidence that the session is gone.
- **Page coverage**: the login form, the reload probe, the CSRF header wiring
  and sign-out are exercised against a DOM in `approval_page_dom.test.ts`, which
  runs the real `approval_page.html` script rather than asserting on its text.

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
