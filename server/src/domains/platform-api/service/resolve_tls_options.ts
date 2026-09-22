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
 * Append a chain bundle to the leaf certificate.
 *
 * `https.createServer` does not send its `ca` option to clients — for a server
 * that option is the trust store used to verify *client* certificates. The
 * only way to present intermediates is to include them in `cert`, so a
 * configured `caFile` is concatenated onto the leaf.
 */
function appendChain(leaf: Buffer, chain: Buffer): Buffer {
  const needsSeparator = leaf.length > 0 && leaf.at(-1) !== 0x0a
  return Buffer.concat(needsSeparator ? [leaf, Buffer.from('\n'), chain] : [leaf, chain])
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
    const leaf = readCertFile(tls.certFile, 'certFile')
    const key = readCertFile(tls.keyFile, 'keyFile')
    const options: ResolvedTlsOptions = {
      minVersion: tls.minVersion,
      cert: tls.caFile ? appendChain(leaf, readCertFile(tls.caFile, 'caFile')) : leaf,
      key,
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
