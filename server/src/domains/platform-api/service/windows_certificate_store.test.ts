// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  WINDOWS_STORE_EXPORT_SCRIPT,
  exportCertificateFromWindowsStore,
  type PowerShellResult,
} from './windows_certificate_store.js'
import type { WindowsStoreSelector } from '../types/tls_config.js'

const thumbprintSelector: WindowsStoreSelector = {
  location: 'LocalMachine',
  name: 'My',
  thumbprint: 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4',
}

function ok(stdout: string): PowerShellResult {
  return { status: 0, stdout, stderr: '' }
}

describe('exportCertificateFromWindowsStore', () => {
  it('refuses to run on a non-Windows platform with an actionable message', () => {
    expect(() =>
      exportCertificateFromWindowsStore(thumbprintSelector, {
        platform: 'linux',
        runPowerShell: () => ok(''),
      }),
    ).toThrow(/only supported on Windows \(running on linux\)/)
  })

  it('passes the selector through the environment, never the script text', () => {
    const seen: Array<{ script: string; env: NodeJS.ProcessEnv }> = []

    const result = exportCertificateFromWindowsStore(thumbprintSelector, {
      platform: 'win32',
      runPowerShell: (script, env) => {
        seen.push({ script, env })
        return ok(Buffer.from('pkcs12-bytes').toString('base64'))
      },
    })

    expect(seen).toHaveLength(1)
    expect(seen[0].script).toBe(WINDOWS_STORE_EXPORT_SCRIPT)
    expect(seen[0].env.LUCIFER_TLS_STORE_PATH).toBe('LocalMachine\\My')
    expect(seen[0].env.LUCIFER_TLS_THUMBPRINT).toBe(thumbprintSelector.thumbprint)
    expect(seen[0].env.LUCIFER_TLS_DNS_NAME).toBe('')
    expect(seen[0].env.LUCIFER_TLS_SUBJECT).toBe('')
    expect(result.pfx.toString()).toBe('pkcs12-bytes')
  })

  it('matches on the certificate DNS names, not the subject DN, when dnsName is set', () => {
    let env: NodeJS.ProcessEnv | undefined
    exportCertificateFromWindowsStore(
      { location: 'LocalMachine', name: 'My', dnsName: 'pippo.codewrecks.com' },
      {
        platform: 'win32',
        runPowerShell: (_script, seenEnv) => {
          env = seenEnv
          return ok(Buffer.from('x').toString('base64'))
        },
      },
    )

    expect(env?.LUCIFER_TLS_DNS_NAME).toBe('pippo.codewrecks.com')
    expect(env?.LUCIFER_TLS_THUMBPRINT).toBe('')
    expect(env?.LUCIFER_TLS_SUBJECT).toBe('')
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain('$_.DnsNameList.Unicode -contains $dnsName')
  })

  it('prefers a currently valid certificate when a name matches more than one', () => {
    // A renewal leaves the superseded certificate in the store, so the script
    // narrows a multi-match to the ones that could serve traffic today before
    // it gives up and asks for a thumbprint.
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain(
      '$usable = @($certs | Where-Object { $_.HasPrivateKey -and $_.NotBefore -le $now -and $_.NotAfter -gt $now })',
    )
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain('use a thumbprint to disambiguate')
  })

  it('compares a 64-character thumbprint as a SHA-256 fingerprint, not as Thumbprint', () => {
    // X509Certificate2.Thumbprint is SHA-1, so a SHA-256 value accepted by the
    // config validator would otherwise match nothing at all.
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain('if ($wanted.Length -eq 64) {')
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain(
      '[BitConverter]::ToString($sha256.ComputeHash($_.RawData)).Replace("-", "") -eq $wanted',
    )
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain('$certs = @($certs | Where-Object { $_.Thumbprint -eq $wanted })')
  })

  it('matches the subject literally so a wildcard character cannot select another certificate', () => {
    // -like would read *, ? and [ in an operator-supplied subject as pattern
    // syntax; IndexOf is a literal comparison.
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain(
      '$_.Subject.IndexOf($subject, [System.StringComparison]::OrdinalIgnoreCase) -ge 0',
    )
    expect(WINDOWS_STORE_EXPORT_SCRIPT).not.toContain('$_.Subject -like')
  })

  it('reads the issuing intermediates out of the store and leaves the root out', () => {
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain('$chain.Build($cert)')
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain(
      'if ($issuer.Thumbprint -ne $cert.Thumbprint -and $issuer.Subject -ne $issuer.Issuer) {',
    )
    // The bundle, not the bare leaf, is what gets exported.
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain('$bytes = $bundle.Export(')
  })

  it('serves the leaf alone rather than failing when the chain cannot be read', () => {
    expect(WINDOWS_STORE_EXPORT_SCRIPT).toContain(
      'Write-Warning "Could not read the issuing chain from the store: $($_.Exception.Message)"',
    )
  })

  it('generates a fresh single-use passphrase per export', () => {
    const passphrases: string[] = []
    const deps = {
      platform: 'win32' as const,
      runPowerShell: (_script: string, env: NodeJS.ProcessEnv) => {
        passphrases.push(env.LUCIFER_TLS_EXPORT_PASSWORD ?? '')
        return ok(Buffer.from('x').toString('base64'))
      },
    }

    const first = exportCertificateFromWindowsStore(thumbprintSelector, deps)
    const second = exportCertificateFromWindowsStore(thumbprintSelector, deps)

    expect(passphrases[0]).not.toBe(passphrases[1])
    expect(first.passphrase).toBe(passphrases[0])
    expect(second.passphrase).toBe(passphrases[1])
  })

  it('sets the subject variable when selecting by subject', () => {
    let subject: string | undefined
    exportCertificateFromWindowsStore(
      { location: 'CurrentUser', name: 'My', subject: 'CN=lucifer' },
      {
        platform: 'win32',
        runPowerShell: (_script, env) => {
          subject = env.LUCIFER_TLS_SUBJECT
          return ok(Buffer.from('x').toString('base64'))
        },
      },
    )
    expect(subject).toBe('CN=lucifer')
  })

  it('surfaces the PowerShell error output on a non-zero exit', () => {
    expect(() =>
      exportCertificateFromWindowsStore(thumbprintSelector, {
        platform: 'win32',
        runPowerShell: () => ({ status: 1, stdout: '', stderr: 'key not exportable' }),
      }),
    ).toThrow(/exit 1\): key not exportable/)
  })

  it('reports a missing PowerShell binary distinctly from a failed export', () => {
    expect(() =>
      exportCertificateFromWindowsStore(thumbprintSelector, {
        platform: 'win32',
        runPowerShell: () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn ENOENT') }),
      }),
    ).toThrow(/Failed to run PowerShell.*spawn ENOENT/)
  })

  it('rejects an empty export instead of handing an empty bundle to the listener', () => {
    expect(() =>
      exportCertificateFromWindowsStore(thumbprintSelector, {
        platform: 'win32',
        runPowerShell: () => ok('  \n '),
      }),
    ).toThrow(/returned no certificate data/)
  })
})
