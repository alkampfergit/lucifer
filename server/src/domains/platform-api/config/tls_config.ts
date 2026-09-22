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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function parseStoreSelector(value: unknown, ctx: string): WindowsStoreSelector {
  if (value === undefined) {
    throw new Error(`${ctx}: "store" is required when "source" is "windows-store".`)
  }
  if (!isRecord(value)) {
    throw new Error(`${ctx}: "store" must be an object.`)
  }

  const location = value.location ?? DEFAULT_WINDOWS_STORE_LOCATION
  if (!isWindowsStoreLocation(location)) {
    throw new Error(`${ctx}: "store.location" must be "LocalMachine" or "CurrentUser".`)
  }

  const name = value.name ?? DEFAULT_WINDOWS_STORE_NAME
  if (typeof name !== 'string' || !STORE_NAME_PATTERN.test(name)) {
    throw new Error(`${ctx}: "store.name" must be an alphanumeric store name (e.g. "My", "Root").`)
  }

  const hasThumbprint = value.thumbprint !== undefined
  const hasSubject = value.subject !== undefined
  if (hasThumbprint === hasSubject) {
    throw new Error(`${ctx}: set exactly one of "store.thumbprint" or "store.subject".`)
  }

  if (hasThumbprint) {
    if (typeof value.thumbprint !== 'string') {
      throw new Error(`${ctx}: "store.thumbprint" must be a string.`)
    }
    // Certificate manager copies thumbprints with spaces; normalise so the
    // operator can paste them unchanged.
    const thumbprint = value.thumbprint.replaceAll(/[\s:]/g, '').toUpperCase()
    if (!THUMBPRINT_PATTERN.test(thumbprint)) {
      throw new Error(
        `${ctx}: "store.thumbprint" must be a hex certificate thumbprint (40 or 64 characters).`,
      )
    }
    return { location, name, thumbprint }
  }

  if (typeof value.subject !== 'string' || value.subject.length === 0) {
    throw new Error(`${ctx}: "store.subject" must be a non-empty string.`)
  }
  return { location, name, subject: value.subject }
}

function parseTlsConfig(value: unknown, configDir: string, ctx: string): TlsConfig {
  if (!isRecord(value)) {
    throw new Error(`${ctx}: expected an object.`)
  }

  if (!isTlsSource(value.source)) {
    throw new Error(`${ctx}: "source" must be one of pem, pfx, windows-store.`)
  }
  const source = value.source

  const minVersion = value.minVersion ?? DEFAULT_TLS_MIN_VERSION
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
