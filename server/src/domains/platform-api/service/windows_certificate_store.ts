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
 *
 * `DnsNameList` is the certificate provider's view of the host names a
 * certificate was issued for: its subject alternative names, falling back to
 * the simple subject name when the certificate carries no SAN extension. That
 * is the name an operator reads in certmgr, so it is what `dnsName` matches.
 */
export const WINDOWS_STORE_EXPORT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  String.raw`$path = 'Cert:\' + $env:LUCIFER_TLS_STORE_PATH`,
  '$certs = @(Get-ChildItem -Path $path)',
  'if ($env:LUCIFER_TLS_THUMBPRINT) {',
  '  $certs = @($certs | Where-Object { $_.Thumbprint -eq $env:LUCIFER_TLS_THUMBPRINT })',
  '} elseif ($env:LUCIFER_TLS_DNS_NAME) {',
  '  $dnsName = $env:LUCIFER_TLS_DNS_NAME',
  '  $certs = @($certs | Where-Object {',
  '    $_.DnsNameList.Unicode -contains $dnsName -or $_.DnsNameList.Punycode -contains $dnsName',
  '  })',
  '} elseif ($env:LUCIFER_TLS_SUBJECT) {',
  '  $certs = @($certs | Where-Object { $_.Subject -like "*$($env:LUCIFER_TLS_SUBJECT)*" })',
  '} else {',
  '  throw "No certificate selector was supplied."',
  '}',
  'if ($certs.Count -eq 0) { throw "No certificate in $path matched the configured selector." }',
  'if ($certs.Count -gt 1) {',
  '  # A renewed certificate leaves the superseded one in the store, so narrow',
  '  # a name match to the ones that could actually serve traffic today.',
  '  $now = Get-Date',
  '  $usable = @($certs | Where-Object { $_.HasPrivateKey -and $_.NotBefore -le $now -and $_.NotAfter -gt $now })',
  '  if ($usable.Count -gt 0) { $certs = $usable }',
  '}',
  'if ($certs.Count -gt 1) { throw "$($certs.Count) certificates in $path matched the configured selector; use a thumbprint to disambiguate." }',
  '$cert = $certs[0]',
  'if (-not $cert.HasPrivateKey) { throw "Certificate $($cert.Thumbprint) has no usable private key in $path." }',
  '$bytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $env:LUCIFER_TLS_EXPORT_PASSWORD)',
  '[Convert]::ToBase64String($bytes)',
].join('\n')

/**
 * Windows ships PowerShell at a fixed location under the system root. Spawning
 * it by absolute path rather than by name keeps the lookup off `PATH`, which a
 * less privileged account may be able to prepend to.
 */
const POWERSHELL_RELATIVE_PATH = String.raw`\System32\WindowsPowerShell\v1.0\powershell.exe`
const DEFAULT_SYSTEM_ROOT = String.raw`C:\Windows`

function powerShellPath(): string {
  return `${process.env.SystemRoot || DEFAULT_SYSTEM_ROOT}${POWERSHELL_RELATIVE_PATH}`
}

function runWithPowerShell(script: string, env: NodeJS.ProcessEnv): PowerShellResult {
  const result = spawnSync(
    powerShellPath(),
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

function selectorEnv(selector: WindowsStoreSelector, passphrase: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LUCIFER_TLS_STORE_PATH: `${selector.location}\\${selector.name}`,
    LUCIFER_TLS_THUMBPRINT: selector.thumbprint ?? '',
    LUCIFER_TLS_DNS_NAME: selector.dnsName ?? '',
    LUCIFER_TLS_SUBJECT: selector.subject ?? '',
    LUCIFER_TLS_EXPORT_PASSWORD: passphrase,
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

  const result = runner(WINDOWS_STORE_EXPORT_SCRIPT, selectorEnv(selector, passphrase))

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
