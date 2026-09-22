import { randomBytes, X509Certificate } from 'node:crypto'
import { createChildLogger } from '../../../lib/logger.js'
import type { WindowsStoreLocation, WindowsStoreSelector } from '../types/tls_config.js'
import {
  loadWindowsCryptoApi,
  type WindowsCryptoApi,
  type WindowsStoreCertificate,
} from './windows_crypto_api.js'

const log = createChildLogger('tls')

export interface WindowsStoreExport {
  /** PKCS#12 bundle exported from the store, protected by `passphrase`. */
  pfx: Buffer
  /** Single-use password generated for this export; never persisted. */
  passphrase: string
}

export interface WindowsStoreDeps {
  platform?: NodeJS.Platform
  /** Injected in tests; defaults to the real CryptoAPI binding. */
  cryptoApi?: WindowsCryptoApi
  /** Reference time for the validity-window tie-break. */
  now?: Date
  warn?: (message: string) => void
}

/** Containers holding issuing certificates, searched when building the chain. */
const CHAIN_STORE_NAMES = ['CA', 'Root'] as const
const CHAIN_LOCATIONS: readonly WindowsStoreLocation[] = ['LocalMachine', 'CurrentUser']
/** Guards against a cross-signed loop; real chains are three or four deep. */
const MAX_CHAIN_DEPTH = 10
/** certmgr and PowerShell render store paths as `Cert:\LocalMachine\My`. */
const STORE_PATH_SEPARATOR = '\\'

function storePathOf(location: WindowsStoreLocation, name: string): string {
  return ['Cert:', location, name].join(STORE_PATH_SEPARATOR)
}

const SHA256_THUMBPRINT_LENGTH = 64

interface StoreEntry {
  certificate: WindowsStoreCertificate
  x509: X509Certificate
}

function normaliseFingerprint(value: string): string {
  return value.replaceAll(':', '').toUpperCase()
}

/**
 * Parse what the store handed back. A container can hold an entry Node cannot
 * read; skipping it is better than failing the boot over a certificate that
 * was never the one asked for. The handle is still returned to the caller for
 * release, which is why the raw list is kept separately.
 */
function parseEntries(certificates: readonly WindowsStoreCertificate[]): StoreEntry[] {
  const entries: StoreEntry[] = []
  for (const certificate of certificates) {
    try {
      entries.push({ certificate, x509: new X509Certificate(certificate.der) })
    } catch {
      continue
    }
  }
  return entries
}

/** Common names from a subject DN, which `node:crypto` renders one RDN per line. */
function commonNames(subject: string): string[] {
  return subject
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.toUpperCase().startsWith('CN='))
    .map((line) => line.slice(3).trim())
}

/**
 * The host names the certificate was issued for: its subject alternative
 * names, falling back to the common name when it carries no DNS SAN. That is
 * the list certmgr shows under *Issued To*, so it is what `dnsName` matches.
 */
function dnsNames(x509: X509Certificate): string[] {
  const names = (x509.subjectAltName ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.toLowerCase().startsWith('dns:'))
    .map((entry) => entry.slice(4).trim().replaceAll(/^"|"$/g, ''))

  return names.length > 0 ? names : commonNames(x509.subject)
}

/**
 * The same subject in the three renderings an operator may have copied it
 * from: the one-per-line form `node:crypto` prints, and the comma-joined form
 * certmgr and .NET show — which lists the RDNs in the opposite order.
 */
function subjectRenderings(subject: string): string[] {
  const rdns = subject.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  return [subject, rdns.join(', '), [...rdns].reverse().join(', ')]
}

function matchesSelector(x509: X509Certificate, selector: WindowsStoreSelector): boolean {
  if (selector.thumbprint) {
    const actual =
      selector.thumbprint.length === SHA256_THUMBPRINT_LENGTH ? x509.fingerprint256 : x509.fingerprint
    return normaliseFingerprint(actual) === selector.thumbprint
  }

  if (selector.dnsName) {
    const wanted = selector.dnsName.toLowerCase()
    return dnsNames(x509).some((name) => name.toLowerCase() === wanted)
  }

  if (selector.subject) {
    // Literal substring: a `*`, `?` or `[` in an operator-supplied subject is
    // matched as itself, never as pattern syntax.
    const wanted = selector.subject.toLowerCase()
    return subjectRenderings(x509.subject).some((rendering) => rendering.toLowerCase().includes(wanted))
  }

  return false
}

function isCurrentlyValid(x509: X509Certificate, now: Date): boolean {
  return x509.validFromDate <= now && x509.validToDate > now
}

/**
 * Whether `certificate` was really issued by `issuer`.
 *
 * `checkIssued` is specified as a comparison of issuer and subject names and
 * key identifiers, and certificates from one CA share those — a key rollover
 * reissues the same subject DN under a new key. The signature check makes the
 * requirement explicit rather than leaving which CA's certificate enters the
 * chain to depend on how far a given OpenSSL build happens to go.
 */
function isIssuedBy(certificate: X509Certificate, issuer: X509Certificate): boolean {
  if (!certificate.checkIssued(issuer)) return false
  try {
    return certificate.verify(issuer.publicKey)
  } catch {
    // An issuer whose public key node:crypto cannot read is not one we can
    // prove signed this certificate.
    return false
  }
}

/**
 * Self-*signed*, not merely self-issued: a rollover certificate names itself
 * as its own issuer but is signed by the CA's previous key, and it belongs in
 * the chain rather than being mistaken for the root and dropped.
 */
function isSelfSigned(x509: X509Certificate): boolean {
  return isIssuedBy(x509, x509)
}

/**
 * Pick the single certificate the selector names.
 *
 * A renewal leaves the superseded certificate in the store, so a name match
 * commonly hits two. Rather than failing the boot, the match is narrowed to
 * the certificates that could actually serve traffic today; only if that still
 * leaves more than one does startup give up and ask for a thumbprint.
 */
function selectCertificate(
  entries: readonly StoreEntry[],
  selector: WindowsStoreSelector,
  storePath: string,
  now: Date,
): StoreEntry {
  const matched = entries.filter((entry) => matchesSelector(entry.x509, selector))
  if (matched.length === 0) {
    throw new Error(`No certificate in ${storePath} matched the configured selector.`)
  }

  let usable = matched
  if (matched.length > 1) {
    const serviceable = matched.filter(
      (entry) => entry.certificate.hasPrivateKey && isCurrentlyValid(entry.x509, now),
    )
    if (serviceable.length > 0) usable = serviceable
  }
  if (usable.length > 1) {
    throw new Error(
      `${usable.length} certificates in ${storePath} matched the configured selector; ` +
      'use a thumbprint to disambiguate.',
    )
  }

  const entry = usable[0]
  if (!entry.certificate.hasPrivateKey) {
    throw new Error(
      `Certificate ${normaliseFingerprint(entry.x509.fingerprint)} has no usable private key in ${storePath}.`,
    )
  }
  return entry
}

/**
 * Walk from the leaf towards the root, collecting the issuing intermediates.
 *
 * Exporting the leaf on its own emits no chain, and a client that does not
 * already hold the intermediates cannot build a path to the root. The
 * self-signed root is deliberately left out: a client has to trust it locally
 * anyway and gains nothing from being sent a copy.
 */
function collectIssuers(
  leaf: StoreEntry,
  candidates: readonly StoreEntry[],
  warn: (message: string) => void,
): WindowsStoreCertificate[] {
  const chain: WindowsStoreCertificate[] = []
  const seen = new Set([leaf.x509.fingerprint256])
  let current = leaf

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
    const issuer = candidates.find(
      (entry) => !seen.has(entry.x509.fingerprint256) && isIssuedBy(current.x509, entry.x509),
    )
    if (!issuer) {
      warn(`Could not read the issuing chain from the store above ${current.x509.subject.replaceAll('\n', ', ')}.`)
      return chain
    }
    seen.add(issuer.x509.fingerprint256)
    if (isSelfSigned(issuer.x509)) {
      return chain
    }
    chain.push(issuer.certificate)
    current = issuer
  }

  warn(`Stopped building the certificate chain after ${MAX_CHAIN_DEPTH} issuers.`)
  return chain
}

/**
 * Gather the issuing certificates for `leaf` out of the intermediate and root
 * containers. A container that cannot be opened is a warning, not a failure:
 * the leaf can still be served on its own.
 */
function chainCandidates(
  api: WindowsCryptoApi,
  storeEntries: readonly StoreEntry[],
  opened: WindowsStoreCertificate[][],
  warn: (message: string) => void,
): StoreEntry[] {
  const candidates = [...storeEntries]

  for (const location of CHAIN_LOCATIONS) {
    for (const name of CHAIN_STORE_NAMES) {
      try {
        const batch = api.listCertificates(location, name)
        opened.push(batch)
        candidates.push(...parseEntries(batch))
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        warn(`Could not read ${storePathOf(location, name)} while building the chain: ${reason}`)
      }
    }
  }

  return candidates
}

/**
 * Read the selected certificate, its private key, and its issuing
 * intermediates out of the Windows certificate store and return them as an
 * in-memory PKCS#12 bundle.
 *
 * The store is read through the native CryptoAPI in `crypt32.dll`; no process
 * is spawned and nothing touches disk. The private key must still be marked
 * **exportable** — a key held by a CNG or HSM provider that refuses to release
 * it cannot be used, because Node's TLS stack needs the key bytes. A
 * `LocalMachine` store normally requires an elevated process.
 */
export function exportCertificateFromWindowsStore(
  selector: WindowsStoreSelector,
  deps: WindowsStoreDeps = {},
): WindowsStoreExport {
  const platform = deps.platform ?? process.platform
  if (platform !== 'win32') {
    throw new Error(
      `"tls.source": "windows-store" is only supported on Windows (running on ${platform}). ` +
      'Export the certificate to a .pfx or a PEM pair and use "source": "pfx" or "source": "pem" instead.',
    )
  }

  const api = deps.cryptoApi ?? loadWindowsCryptoApi()
  const warn = deps.warn ?? ((message: string) => log.warn(message))
  const storePath = storePathOf(selector.location, selector.name)
  const opened: WindowsStoreCertificate[][] = []

  try {
    const storeCertificates = api.listCertificates(selector.location, selector.name)
    opened.push(storeCertificates)
    const storeEntries = parseEntries(storeCertificates)

    const leaf = selectCertificate(storeEntries, selector, storePath, deps.now ?? new Date())
    const issuers = isSelfSigned(leaf.x509)
      ? []
      : collectIssuers(leaf, chainCandidates(api, storeEntries, opened, warn), warn)

    const passphrase = randomBytes(32).toString('base64')
    const pfx = api.exportPkcs12([leaf.certificate, ...issuers], passphrase)
    if (pfx.length === 0) {
      throw new Error('Windows certificate store export returned no certificate data.')
    }
    return { pfx, passphrase }
  } finally {
    for (const batch of opened) {
      api.release(batch)
    }
  }
}
