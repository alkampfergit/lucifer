import { readFileSync } from 'node:fs'
import { TLS_PASSPHRASE_ENV, type ResolvedTlsOptions, type TlsConfig } from '../types/tls_config.js'
import { exportCertificateFromWindowsStore, type WindowsStoreDeps } from './windows_certificate_store.js'

function readCertFile(filePath: string | undefined, key: string): Buffer {
  if (!filePath) {
    throw new Error(`TLS config is missing "${key}".`)
  }
  try {
    return readFileSync(filePath)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Cannot read TLS "${key}" at ${filePath}: ${reason}`)
  }
}

/**
 * Turn a validated `tls` block into the options handed to
 * `https.createServer`. Certificate material is read once at startup, so a
 * rotated file only takes effect on restart.
 *
 * The passphrase for a PKCS#12 bundle or an encrypted PEM key comes from
 * `LUCIFER_TLS_PASSPHRASE`, never from `lucifer.json` — the config file is
 * commonly committed or mounted read-only alongside non-secret settings.
 */
export function resolveTlsOptions(tls: TlsConfig, deps: WindowsStoreDeps = {}): ResolvedTlsOptions {
  const passphrase = process.env[TLS_PASSPHRASE_ENV]

  if (tls.source === 'pem') {
    const options: ResolvedTlsOptions = {
      minVersion: tls.minVersion,
      cert: readCertFile(tls.certFile, 'certFile'),
      key: readCertFile(tls.keyFile, 'keyFile'),
    }
    if (tls.caFile) {
      options.ca = readCertFile(tls.caFile, 'caFile')
    }
    if (passphrase) {
      options.passphrase = passphrase
    }
    return options
  }

  if (tls.source === 'pfx') {
    const options: ResolvedTlsOptions = {
      minVersion: tls.minVersion,
      pfx: readCertFile(tls.pfxFile, 'pfxFile'),
    }
    if (passphrase) {
      options.passphrase = passphrase
    }
    return options
  }

  if (!tls.store) {
    throw new Error('TLS config is missing "store" for "source": "windows-store".')
  }
  const exported = exportCertificateFromWindowsStore(tls.store, deps)
  return { minVersion: tls.minVersion, pfx: exported.pfx, passphrase: exported.passphrase }
}
