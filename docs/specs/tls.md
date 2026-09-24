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
    "certFile": "certs/server.crt",  // leaf certificate
    "keyFile":  "certs/server.key",
    "caFile":   "certs/chain.pem",   // optional intermediates, appended to certFile

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

`certFile` and `keyFile` are required, `caFile` is optional. All are read once
at startup.

`caFile` holds the intermediate certificates between the leaf and the root. Its
contents are **appended to `certFile`** so they are sent to clients during the
handshake. It is not passed to Node's `ca` option: on a server that option is
the trust store used to verify *client* certificates and is never transmitted,
so a chain configured there would never reach a browser.

### `pfx`

`pfxFile` points at a PKCS#12 bundle containing the certificate, its private
key, and any chain certificates. Unlock it with `LUCIFER_TLS_PASSPHRASE`.

### `windows-store`

Windows only. Lucifer calls the **Windows CryptoAPI** in `crypt32.dll`
directly — `CertOpenStore`, `CertEnumCertificatesInStore`,
`PFXExportCertStoreEx` — through [koffi](https://koffi.dev/), an FFI layer that
ships prebuilt binaries per platform, so there is no compiler toolchain
requirement and no child process. Both `crypt32.dll` and `kernel32.dll` are
loaded by absolute path under `%SystemRoot%\System32`, so the DLL search order
cannot be redirected at a library that would then be handed the private key.

The store under `Cert:\<location>\<name>` is enumerated, each certificate is
parsed with `node:crypto`, and the selector is applied in TypeScript. The
chosen certificate and its issuing intermediates are staged in an in-memory
store and exported as a PKCS#12 blob protected by a single-use password
generated per start. Nothing touches disk, and no selector value is ever
interpolated into a script or a command line.

Because the matching runs on parsed certificates rather than on a shell's
string comparison, it is covered by unit tests on every platform. The Windows
CI job additionally boots the real listener from two certificates planted in
`Cert:\CurrentUser\My`: a self-signed one, and a leaf under a planted
`root → intermediate → leaf` chain whose issuers are left in `CA` as
public-only copies. The second handshake is validated by a client that trusts
only the root, so it passes only if the intermediate really was exported and
sent.

Intermediates are looked for in `CA` and `Root` under both `LocalMachine` and
`CurrentUser`. A candidate is accepted as the issuer only when its signature
over the certificate verifies, not merely when the names line up — a CA key
rollover reissues the same subject DN under a new key, and a name-only match
would put the wrong certificate in the chain or mistake a self-issued rollover
for the root.

The staged bundle therefore holds certificates that have no private key, which
is why the export does not set `REPORT_NO_PRIVATE_KEY`. The leaf's own key is
checked before the export, and `REPORT_NOT_ABLE_TO_EXPORT_PRIVATE_KEY` still
turns a key the provider refuses to release into a startup error.

The self-signed root is deliberately left out of the bundle: a client has to
trust it locally anyway and gains nothing from being sent a copy. If the chain
cannot be built the leaf is served on its own and a warning is logged, rather
than the whole startup failing. A self-signed leaf skips the chain search
entirely.

Set exactly one of:

| Selector | Matches |
|---|---|
| `dnsName` | A host name the certificate was issued for, e.g. `pippo.codewrecks.com`. Compared against the certificate's DNS names (its subject alternative names, falling back to the simple subject name when it has none) — the names certmgr shows under *Issued To*. Case-insensitive; surrounding whitespace is trimmed. A wildcard certificate is selected either by its literal name, `*.codewrecks.com`, or by any host it covers under RFC 6125: a `*` that is the whole left-most label covers exactly one label, so `*.codewrecks.com` covers `pippo.codewrecks.com` but not `codewrecks.com` or `a.pippo.codewrecks.com`. A certificate issued for the exact host outranks a wildcard that merely covers it. |
| `thumbprint` | The fingerprint, exactly. 40 hex characters are matched against the SHA-1 thumbprint certmgr shows; 64 hex characters are matched against a SHA-256 fingerprint computed from the certificate. Spaces and colons are stripped and case is ignored, so a value pasted from certmgr works unchanged. |
| `subject` | A **literal** case-insensitive substring of the certificate's subject DN, e.g. `O=Codewrecks`. `*`, `?` and `[` are matched as themselves, not as wildcards. The substring is tried against the subject in each of the renderings tools print it in — one RDN per line, and comma-joined in either RDN order — so a value copied out of certmgr matches. |

Matching nothing is an error. When a `dnsName` or `subject` matches more than
one certificate — the usual case after a renewal leaves the superseded
certificate in the store — the match is narrowed to certificates that have a
private key and are inside their validity window. If that still leaves more
than one, startup fails and asks for a `thumbprint`.

A single selected certificate that is outside its validity window (expired,
or not yet valid) is still served, so a skewed clock does not stop the
gateway, but startup logs a warning naming its thumbprint and validity dates:
every client handshake against it will fail.

Requirements and limits:

- The private key must be marked **exportable**. Non-exportable keys, and
  CNG/HSM-held keys whose provider refuses to release the key, fail with the
  `GetLastError` code reported by CryptoAPI. A native binding does not lift
  this: Node's TLS stack needs the key bytes, so a key that cannot leave its
  provider cannot serve a Node listener however it is reached.
- `LocalMachine` stores normally require an elevated process.
- On any non-Windows platform, `"source": "windows-store"` fails at startup
  with a message pointing at `pem`/`pfx`. The FFI library is never loaded on a
  host that cannot use it.

## Behaviour

- Certificate material is read **once at startup**. Rotating a certificate
  requires a restart.
- The `tls` block is read from the config file named by `--config`. The
  flagless entrypoints (`npm run dev`, `npm start`) fall back to
  `./config/lucifer.json` when that file exists, so they serve HTTPS on the
  same config the CLI would use.
- A malformed `tls` block, a missing certificate file, or a failed Windows
  store export **fails startup** with an error naming the offending field or
  path. The server never falls back to plain HTTP.
- With `tls` set, the port speaks HTTPS **only**. There is no companion
  plain-HTTP port and no redirect, so a client that forgets the scheme fails
  loudly instead of sending its API key in clear text.
- When `port` is omitted from `lucifer.json`, the HTTPS listener defaults to
  port `443`. An explicit `port`, `PORT` environment variable, or CLI `--port`
  overrides that default. Binding `443` normally needs elevated privileges;
  a failed bind (`EACCES`, `EADDRINUSE`, …) stops startup with exit code 1
  and a message naming the port and the settings that move it, instead of an
  uncaught stack trace.
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
| Certificate selection and chain assembly for the Windows store | `server/src/domains/platform-api/service/windows_certificate_store.ts` |
| Native CryptoAPI binding (`crypt32.dll`) | `server/src/domains/platform-api/service/windows_crypto_api.ts` |
| Listener construction | `server/src/domains/platform-api/service/create_http_server.ts` |
| Default config path for the flagless entrypoints | `server/src/lib/config_path.ts` |
