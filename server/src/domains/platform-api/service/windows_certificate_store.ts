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
 *
 * A 40-character `thumbprint` is compared against `X509Certificate2.Thumbprint`
 * (SHA-1, the value certmgr shows); a 64-character one is compared against a
 * SHA-256 fingerprint computed from the certificate's DER bytes.
 *
 * The bundle carries the issuing intermediates as well, read back out of the
 * store via `X509Chain`, so the listener can present a complete chain.
 */
export const WINDOWS_STORE_EXPORT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  String.raw`$path = 'Cert:\' + $env:LUCIFER_TLS_STORE_PATH`,
  '$certs = @(Get-ChildItem -Path $path)',
  'if ($env:LUCIFER_TLS_THUMBPRINT) {',
  '  $wanted = $env:LUCIFER_TLS_THUMBPRINT',
  '  if ($wanted.Length -eq 64) {',
  '    # X509Certificate2.Thumbprint is SHA-1, so a SHA-256 fingerprint has to',
  '    # be computed from the DER bytes instead of compared against it.',
  '    $sha256 = [System.Security.Cryptography.SHA256]::Create()',
  '    $certs = @($certs | Where-Object {',
  '      [BitConverter]::ToString($sha256.ComputeHash($_.RawData)).Replace("-", "") -eq $wanted',
  '    })',
  '  } else {',
  '    $certs = @($certs | Where-Object { $_.Thumbprint -eq $wanted })',
  '  }',
  '} elseif ($env:LUCIFER_TLS_DNS_NAME) {',
  '  $dnsName = $env:LUCIFER_TLS_DNS_NAME',
  '  $certs = @($certs | Where-Object {',
  '    $_.DnsNameList.Unicode -contains $dnsName -or $_.DnsNameList.Punycode -contains $dnsName',
  '  })',
  '} elseif ($env:LUCIFER_TLS_SUBJECT) {',
  '  # Literal case-insensitive substring. -like would read a *, ? or [ in an',
  '  # operator-supplied subject as a wildcard and select an unrelated key.',
  '  $subject = $env:LUCIFER_TLS_SUBJECT',
  '  $certs = @($certs | Where-Object {',
  '    $_.Subject.IndexOf($subject, [System.StringComparison]::OrdinalIgnoreCase) -ge 0',
  '  })',
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
  '# Read the issuing certificates out of the store too. Exporting the leaf on',
  '# its own emits no intermediates, and a client that does not already hold',
  '# them cannot build a path to the root.',
  '$bundle = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2Collection',
  '[void]$bundle.Add($cert)',
  'try {',
  '  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain',
  "  $chain.ChainPolicy.RevocationMode = 'NoCheck'",
  "  $chain.ChainPolicy.VerificationFlags = 'AllowUnknownCertificateAuthority'",
  '  [void]$chain.Build($cert)',
  '  foreach ($element in $chain.ChainElements) {',
  '    $issuer = $element.Certificate',
  '    # Skip the leaf, already added, and the self-signed root, which a client',
  '    # has to trust locally anyway and gains nothing from receiving.',
  '    if ($issuer.Thumbprint -ne $cert.Thumbprint -and $issuer.Subject -ne $issuer.Issuer) {',
  '      [void]$bundle.Add($issuer)',
  '    }',
  '  }',
  '} catch {',
  '  # An incomplete chain is not fatal: serve the leaf alone and say so.',
  '  Write-Warning "Could not read the issuing chain from the store: $($_.Exception.Message)"',
  '}',
  '$bytes = $bundle.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $env:LUCIFER_TLS_EXPORT_PASSWORD)',
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
 * CNG/HSM key storage provider that refuses the read, cannot be used this way —
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
