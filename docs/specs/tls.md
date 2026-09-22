# TLS

## What it does

Serves the main gateway listener over HTTPS instead of plain HTTP, using a
certificate the operator points at from `lucifer.json`. Without a `tls` block
the listener is plain HTTP, exactly as before this feature existed.

Scope is the **main gateway port only**. Transparent proxy listeners
(`proxy-config.json`) stay plain HTTP in this version; see
[Out of scope](#out-of-scope).

## Config

Optional `tls` block in `lucifer.json`. Relative file paths resolve against
the config file's own directory, the same rule as `dataDir`, alias `path`
entries, and `toolsPath`.

```jsonc
{
  "tls": {
    "source": "pem",                 // "pem" | "pfx" | "windows-store"
    "minVersion": "TLSv1.2",         // "TLSv1.2" (default) | "TLSv1.3"

    // source: "pem"
    "certFile": "certs/server.crt",  // leaf, plus any chain certificates
    "keyFile":  "certs/server.key",
    "caFile":   "certs/chain.pem",   // optional extra CA bundle

    // source: "pfx"
    "pfxFile":  "certs/server.pfx",  // PKCS#12 (.pfx / .p12)

    // source: "windows-store"
    "store": {
      "location": "LocalMachine",         // "LocalMachine" (default) | "CurrentUser"
      "name":     "My",                   // store name, default "My"
      "dnsName":  "pippo.codewrecks.com"  // or "thumbprint" / "subject" — exactly one
    }
  }
}
```

Fields belonging to a different `source` are rejected rather than ignored, so
a half-edited block fails loudly instead of quietly serving the wrong
certificate.

## Passphrase

The passphrase for a PKCS#12 bundle or an encrypted PEM key comes from the
`LUCIFER_TLS_PASSPHRASE` environment variable. It is never read from
`lucifer.json` — that file holds non-secret settings and is commonly
committed or mounted read-only next to them.

## Sources

### `pem`

`certFile` and `keyFile` are required, `caFile` is optional. Both files are
read once at startup.

### `pfx`

`pfxFile` points at a PKCS#12 bundle containing the certificate, its private
key, and any chain certificates. Unlock it with `LUCIFER_TLS_PASSPHRASE`.

### `windows-store`

Windows only. Node has no binding to the Windows certificate store, so
Lucifer shells out to PowerShell (by absolute path under `%SystemRoot%`, never
via `PATH`), locates the certificate under `Cert:\<location>\<name>`, and
exports it as a PKCS#12 blob protected by a single-use password generated per
start. The bundle is returned base64 on stdout and never written to disk.
Selector values are passed as environment variables, not interpolated into the
script, so a crafted `subject` cannot inject PowerShell.

Set exactly one of:

| Selector | Matches |
|---|---|
| `dnsName` | A host name the certificate was issued for, e.g. `pippo.codewrecks.com`. Compared against the certificate's DNS names (its subject alternative names, falling back to the simple subject name when it has none) — the names certmgr shows under *Issued To*. Case-insensitive; a wildcard certificate is named as it appears, `*.codewrecks.com`. Surrounding whitespace is trimmed. |
| `thumbprint` | The thumbprint, exactly. Spaces and colons are stripped and case is ignored, so a value pasted from certmgr works unchanged. |
| `subject` | A substring of the certificate's full subject DN, e.g. `O=Codewrecks`. |

Matching nothing is an error. When a `dnsName` or `subject` matches more than
one certificate — the usual case after a renewal leaves the superseded
certificate in the store — the match is narrowed to certificates that have a
private key and are inside their validity window. If that still leaves more
than one, startup fails and asks for a `thumbprint`.

Requirements and limits:

- The private key must be marked **exportable**. Non-exportable keys, and
  CNG/HSM-held keys whose provider refuses export, fail with the underlying
  PowerShell error.
- `LocalMachine` stores normally require an elevated process.
- On any non-Windows platform, `"source": "windows-store"` fails at startup
  with a message pointing at `pem`/`pfx`, rather than a confusing spawn error.

## Behaviour

- Certificate material is read (or exported) **once at startup**. Rotating a
  certificate requires a restart.
- A malformed `tls` block, a missing certificate file, or a failed Windows
  store export **fails startup** with an error naming the offending field or
  path. The server never falls back to plain HTTP.
- With `tls` set, the port speaks HTTPS **only**. There is no companion
  plain-HTTP port and no redirect, so a client that forgets the scheme fails
  loudly instead of sending its API key in clear text.
- The startup log line records `scheme` (`http` or `https`); the
  "Ensure HTTPS is configured for production" warning is suppressed when TLS
  is on.

## Out of scope

Deliberately not in this version:

- Per-listener certificates for `proxy-config.json` mappings.
- mTLS / required client certificates.
- Hot reload on certificate rotation.
- HTTP→HTTPS redirect on a second port.

## Implementation

| Concern | Location |
|---|---|
| `tls` block validation and path resolution | `server/src/domains/platform-api/config/tls_config.ts` |
| Certificate material → `https.createServer` options | `server/src/domains/platform-api/service/resolve_tls_options.ts` |
| Windows certificate store export | `server/src/domains/platform-api/service/windows_certificate_store.ts` |
| Listener construction | `server/src/domains/platform-api/service/create_http_server.ts` |
