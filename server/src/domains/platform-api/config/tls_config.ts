import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadJsonConfig } from '../../../lib/json_config_loader.js'
import {
  DEFAULT_TLS_MIN_VERSION,
  DEFAULT_WINDOWS_STORE_LOCATION,
  DEFAULT_WINDOWS_STORE_NAME,
  type TlsConfig,
  type TlsMinVersion,
  type TlsSource,
  type WindowsStoreLocation,
  type WindowsStoreSelector,
} from '../types/tls_config.js'

/**
 * Fields that belong to exactly one `source`. Used to reject blocks that mix
 * two sources, which would otherwise silently ignore half the operator's
 * configuration.
 */
const FIELDS_BY_SOURCE: Record<TlsSource, readonly string[]> = {
  pem: ['certFile', 'keyFile', 'caFile'],
  pfx: ['pfxFile'],
  'windows-store': ['store'],
}

/** `X509Certificate2.Thumbprint` is SHA-1 (40 hex); SHA-256 (64 hex) is also accepted. */
const THUMBPRINT_PATTERN = /^(?:[0-9A-F]{40}|[0-9A-F]{64})$/
const STORE_NAME_PATTERN = /^[A-Za-z0-9]+$/

/** One DNS label: alphanumeric with inner hyphens, at most 63 characters. */
const DNS_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
/** Maximum length of a DNS name, RFC 1035. */
const MAX_DNS_NAME_LENGTH = 253

/** Ways to pick one certificate out of the store, in the order they are documented. */
const STORE_SELECTOR_KEYS = ['thumbprint', 'dnsName', 'subject'] as const
type StoreSelectorKey = (typeof STORE_SELECTOR_KEYS)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Apply a default only when the key is absent. Deliberately not `??`: that
 * also swallows an explicit `null`, so `"minVersion": null` would silently
 * start a listener on the default rather than telling the operator the value
 * they wrote is not a valid one.
 */
function whenAbsent<T>(value: unknown, fallback: T): unknown {
  return value === undefined ? fallback : value
}

function isTlsSource(value: unknown): value is TlsSource {
  return value === 'pem' || value === 'pfx' || value === 'windows-store'
}

function isTlsMinVersion(value: unknown): value is TlsMinVersion {
  return value === 'TLSv1.2' || value === 'TLSv1.3'
}

function isWindowsStoreLocation(value: unknown): value is WindowsStoreLocation {
  return value === 'LocalMachine' || value === 'CurrentUser'
}

/**
 * Resolve a configured path against the config file's directory, same rule as
 * alias `path` and `toolsPath` entries, and fail fast when it is missing. An
 * operator wants a descriptive startup error, not a TLS handshake failure.
 */
function resolveCertPath(
  tls: Record<string, unknown>,
  key: string,
  configDir: string,
  ctx: string,
): string {
  const value = tls[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${ctx}: "${key}" is required and must be a non-empty string.`)
  }
  const resolved = resolve(configDir, value)
  if (!existsSync(resolved)) {
    throw new Error(`${ctx}: "${key}" points at a file that does not exist: ${resolved}`)
  }
  return resolved
}

function rejectForeignFields(tls: Record<string, unknown>, source: TlsSource, ctx: string): void {
  for (const [otherSource, fields] of Object.entries(FIELDS_BY_SOURCE)) {
    if (otherSource === source) continue
    for (const field of fields) {
      if (tls[field] !== undefined) {
        throw new Error(
          `${ctx}: "${field}" is only valid with "source": "${otherSource}", but "source" is "${source}".`,
        )
      }
    }
  }
}

/**
 * Accepts a host name such as `pippo.codewrecks.com`, optionally with a
 * leading `*.` wildcard label, matching what an operator reads off the
 * certificate in certmgr. Validated per label so the pattern stays linear.
 */
function isDnsName(value: string): boolean {
  if (value.length > MAX_DNS_NAME_LENGTH) return false
  const labels = value.split('.')
  const named = labels[0] === '*' ? labels.slice(1) : labels
  return named.length > 0 && named.every((label) => DNS_LABEL_PATTERN.test(label))
}

function normaliseThumbprint(value: string, ctx: string): string {
  // Certificate manager copies thumbprints with spaces; normalise so the
  // operator can paste them unchanged.
  const thumbprint = value.replaceAll(/[\s:]/g, '').toUpperCase()
  if (!THUMBPRINT_PATTERN.test(thumbprint)) {
    throw new Error(
      `${ctx}: "store.thumbprint" must be a hex certificate thumbprint (40 or 64 characters).`,
    )
  }
  return thumbprint
}

/**
 * Pick the single selector criterion. Requiring exactly one keeps the match
 * rule readable: two criteria would leave the operator guessing whether they
 * are ANDed or whether one silently wins.
 */
function parseSelectorCriterion(
  store: Record<string, unknown>,
  ctx: string,
): Pick<WindowsStoreSelector, StoreSelectorKey> {
  const provided = STORE_SELECTOR_KEYS.filter((key) => store[key] !== undefined)
  if (provided.length !== 1) {
    const options = STORE_SELECTOR_KEYS.map((key) => `"store.${key}"`).join(', ')
    throw new Error(`${ctx}: set exactly one of ${options}.`)
  }

  const key = provided[0]
  const value = store[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${ctx}: "store.${key}" must be a non-empty string.`)
  }

  if (key === 'thumbprint') return { thumbprint: normaliseThumbprint(value, ctx) }
  if (key === 'subject') return { subject: value }

  const dnsName = value.trim()
  if (!isDnsName(dnsName)) {
    throw new Error(
      `${ctx}: "store.dnsName" must be a host name such as "pippo.codewrecks.com".`,
    )
  }
  return { dnsName }
}

function parseStoreSelector(value: unknown, ctx: string): WindowsStoreSelector {
  if (value === undefined) {
    throw new Error(`${ctx}: "store" is required when "source" is "windows-store".`)
  }
  if (!isRecord(value)) {
    throw new Error(`${ctx}: "store" must be an object.`)
  }

  const location = whenAbsent(value.location, DEFAULT_WINDOWS_STORE_LOCATION)
  if (!isWindowsStoreLocation(location)) {
    throw new Error(`${ctx}: "store.location" must be "LocalMachine" or "CurrentUser".`)
  }

  const name = whenAbsent(value.name, DEFAULT_WINDOWS_STORE_NAME)
  if (typeof name !== 'string' || !STORE_NAME_PATTERN.test(name)) {
    throw new Error(`${ctx}: "store.name" must be an alphanumeric store name (e.g. "My", "Root").`)
  }

  return { location, name, ...parseSelectorCriterion(value, ctx) }
}

function parseTlsConfig(value: unknown, configDir: string, ctx: string): TlsConfig {
  if (!isRecord(value)) {
    throw new Error(`${ctx}: expected an object.`)
  }

  if (!isTlsSource(value.source)) {
    throw new Error(`${ctx}: "source" must be one of pem, pfx, windows-store.`)
  }
  const source = value.source

  const minVersion = whenAbsent(value.minVersion, DEFAULT_TLS_MIN_VERSION)
  if (!isTlsMinVersion(minVersion)) {
    throw new Error(`${ctx}: "minVersion" must be "TLSv1.2" or "TLSv1.3".`)
  }

  rejectForeignFields(value, source, ctx)

  if (source === 'pem') {
    const config: TlsConfig = {
      source,
      minVersion,
      certFile: resolveCertPath(value, 'certFile', configDir, ctx),
      keyFile: resolveCertPath(value, 'keyFile', configDir, ctx),
    }
    if (value.caFile !== undefined) {
      config.caFile = resolveCertPath(value, 'caFile', configDir, ctx)
    }
    return config
  }

  if (source === 'pfx') {
    return { source, minVersion, pfxFile: resolveCertPath(value, 'pfxFile', configDir, ctx) }
  }

  return { source, minVersion, store: parseStoreSelector(value.store, ctx) }
}

/**
 * Read the optional `tls` block from `lucifer.json`. Returns `undefined` when
 * no config path was given or the block is absent — the listener then stays
 * plain HTTP, exactly as before this feature existed. Throws a descriptive
 * error when the block is present but malformed.
 */
export function loadTlsConfig(configPath?: string): TlsConfig | undefined {
  if (!configPath) return undefined

  const resolvedPath = resolve(configPath)
  const loaded = loadJsonConfig(resolvedPath, isRecord)
  if (loaded.tls === undefined) return undefined

  return parseTlsConfig(loaded.tls, dirname(resolvedPath), `Invalid "tls" block in ${resolvedPath}`)
}
