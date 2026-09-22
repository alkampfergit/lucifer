import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export interface CertificateFixture {
  dir: string
  certFile: string
  keyFile: string
  pfxFile: string
  pfxPassphrase: string
}

/**
 * Known install locations, probed in order. Resolving an absolute path instead
 * of letting the OS search `PATH` keeps a writable directory on `PATH` from
 * deciding which binary the test suite runs.
 */
const OPENSSL_CANDIDATES = [
  '/usr/bin/openssl',
  '/bin/openssl',
  '/usr/local/bin/openssl',
  '/opt/homebrew/bin/openssl',
  String.raw`C:\Program Files\OpenSSL-Win64\bin\openssl.exe`,
  String.raw`C:\Program Files\Git\usr\bin\openssl.exe`,
]

function findOpenssl(): string | undefined {
  return OPENSSL_CANDIDATES.find((candidate) => existsSync(candidate))
}

/**
 * TLS fixtures are generated at test time rather than committed: a private key
 * in the repository trips secret scanning and would eventually expire.
 */
export function hasOpenssl(): boolean {
  const openssl = findOpenssl()
  return openssl !== undefined && spawnSync(openssl, ['version'], { encoding: 'utf8' }).status === 0
}

function runOpenssl(args: string[]): void {
  const openssl = findOpenssl()
  if (!openssl) {
    throw new Error(`openssl not found in any of: ${OPENSSL_CANDIDATES.join(', ')}`)
  }
  const result = spawnSync(openssl, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`openssl ${args[0]} failed: ${result.stderr || result.stdout}`)
  }
}

/**
 * Generate a throwaway self-signed `localhost` certificate plus the matching
 * PKCS#12 bundle. Written under the repository, not the shared temp directory.
 */
export function createCertificateFixture(label: string, passphrase = 'fixture-pass'): CertificateFixture {
  const dir = join(process.cwd(), `.test-tls-${label}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const certFile = join(dir, 'server.crt')
  const keyFile = join(dir, 'server.key')
  const pfxFile = join(dir, 'server.pfx')

  runOpenssl([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyFile, '-out', certFile,
    '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ])

  runOpenssl([
    'pkcs12', '-export', '-out', pfxFile,
    '-inkey', keyFile, '-in', certFile,
    '-passout', `pass:${passphrase}`,
  ])

  return { dir, certFile, keyFile, pfxFile, pfxPassphrase: passphrase }
}

export function removeCertificateFixture(fixture: CertificateFixture): void {
  rmSync(fixture.dir, { recursive: true, force: true })
}
