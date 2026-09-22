import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { WindowsStoreSelector } from '../types/tls_config.js'

export interface WindowsStoreExport {
  /** PKCS#12 bundle exported from the store, protected by `passphrase`. */
  pfx: Buffer
  /** Single-use password generated for this export; never persisted. */
  passphrase: string
}

export interface PowerShellResult {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}

export type PowerShellRunner = (script: string, env: NodeJS.ProcessEnv) => PowerShellResult

export interface WindowsStoreDeps {
  platform?: NodeJS.Platform
  runPowerShell?: PowerShellRunner
}

/**
 * Locates one certificate in the Windows store and writes it to stdout as a
 * base64 PKCS#12 blob. The bundle never touches disk, so there is no temp file
 * to leak or clean up.
 *
 * Every operator-supplied value is read from the environment rather than
 * interpolated into the script text, so a crafted `subject` cannot inject
 * PowerShell.
 */
export const WINDOWS_STORE_EXPORT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$path = 'Cert:\\' + $env:LUCIFER_TLS_STORE_PATH",
  '$certs = @(Get-ChildItem -Path $path)',
  'if ($env:LUCIFER_TLS_THUMBPRINT) {',
  '  $certs = @($certs | Where-Object { $_.Thumbprint -eq $env:LUCIFER_TLS_THUMBPRINT })',
  '} else {',
  '  $certs = @($certs | Where-Object { $_.Subject -like "*$($env:LUCIFER_TLS_SUBJECT)*" })',
  '}',
  'if ($certs.Count -eq 0) { throw "No certificate in $path matched the configured selector." }',
  'if ($certs.Count -gt 1) { throw "$($certs.Count) certificates in $path matched the configured selector; use a thumbprint to disambiguate." }',
  '$cert = $certs[0]',
  'if (-not $cert.HasPrivateKey) { throw "Certificate $($cert.Thumbprint) has no usable private key in $path." }',
  '$bytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $env:LUCIFER_TLS_EXPORT_PASSWORD)',
  '[Convert]::ToBase64String($bytes)',
].join('\n')

function runWithPowerShell(script: string, env: NodeJS.ProcessEnv): PowerShellResult {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { env, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  )
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  }
}

/**
 * Export the selected certificate (with its private key) from the Windows
 * certificate store as an in-memory PKCS#12 bundle.
 *
 * Requires an exportable private key. Keys marked non-exportable, or held in a
 * CNG/HSM key storage provider that refuses export, cannot be used this way —
 * the PowerShell error is surfaced verbatim so the operator can tell which
 * case they hit. `LocalMachine` stores normally require an elevated process.
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

  const passphrase = randomBytes(32).toString('base64')
  const runner = deps.runPowerShell ?? runWithPowerShell

  const result = runner(WINDOWS_STORE_EXPORT_SCRIPT, {
    ...process.env,
    LUCIFER_TLS_STORE_PATH: `${selector.location}\\${selector.name}`,
    LUCIFER_TLS_THUMBPRINT: selector.thumbprint ?? '',
    LUCIFER_TLS_SUBJECT: selector.subject ?? '',
    LUCIFER_TLS_EXPORT_PASSWORD: passphrase,
  })

  if (result.error) {
    throw new Error(
      `Failed to run PowerShell to read the Windows certificate store: ${result.error.message}`,
    )
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || 'no error output'
    throw new Error(`Windows certificate store export failed (exit ${result.status}): ${detail}`)
  }

  const encoded = result.stdout.replaceAll(/\s/g, '')
  if (encoded.length === 0) {
    throw new Error('Windows certificate store export returned no certificate data.')
  }

  return { pfx: Buffer.from(encoded, 'base64'), passphrase }
}
