/** Where the certificate material comes from. */
export type TlsSource = 'pem' | 'pfx' | 'windows-store'

/** Lowest protocol version the listener will negotiate. */
export type TlsMinVersion = 'TLSv1.2' | 'TLSv1.3'

/** Windows certificate store root to search under `Cert:\`. */
export type WindowsStoreLocation = 'LocalMachine' | 'CurrentUser'

/**
 * Selects one certificate inside the Windows certificate store. Exactly one
 * of `thumbprint` / `dnsName` / `subject` must be set:
 *
 * - `thumbprint` is an exact match on the certificate fingerprint, either the
 *   SHA-1 thumbprint certmgr shows (40 hex) or a SHA-256 one (64 hex).
 * - `dnsName` matches a host name the certificate was issued for
 *   (`pippo.codewrecks.com`), taken from its DNS names.
 * - `subject` is a substring match on the certificate's subject DN.
 */
export interface WindowsStoreSelector {
  location: WindowsStoreLocation
  name: string
  thumbprint?: string
  dnsName?: string
  subject?: string
}

/**
 * Validated `tls` block from `lucifer.json`. File paths are already resolved
 * against the config file's directory; `minVersion` is already defaulted.
 */
export interface TlsConfig {
  source: TlsSource
  minVersion: TlsMinVersion
  /** source: 'pem' — leaf certificate (plus any chain certificates). */
  certFile?: string
  /** source: 'pem' — private key. */
  keyFile?: string
  /** source: 'pem' — optional intermediate chain, appended to `certFile`. */
  caFile?: string
  /** source: 'pfx' — PKCS#12 bundle (.pfx / .p12). */
  pfxFile?: string
  /** source: 'windows-store' — which certificate to pull out of the store. */
  store?: WindowsStoreSelector
}

/**
 * The subset of Node's `https.ServerOptions` Lucifer populates. Kept as its
 * own type so the config and service layers share one contract without the
 * types layer importing `node:https`.
 */
export interface ResolvedTlsOptions {
  minVersion: TlsMinVersion
  /** Leaf certificate, with any configured chain bundle appended to it. */
  cert?: Buffer
  key?: Buffer
  pfx?: Buffer
  passphrase?: string
}

/** Environment variable holding the passphrase for a PFX or encrypted PEM key. */
export const TLS_PASSPHRASE_ENV = 'LUCIFER_TLS_PASSPHRASE'

export const DEFAULT_TLS_MIN_VERSION: TlsMinVersion = 'TLSv1.2'
export const DEFAULT_WINDOWS_STORE_LOCATION: WindowsStoreLocation = 'LocalMachine'
export const DEFAULT_WINDOWS_STORE_NAME = 'My'
