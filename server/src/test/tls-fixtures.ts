import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

export interface ChainFixture {
  dir: string
  /** Self-signed root; never sent to clients. */
  rootDer: Buffer
  /** Intermediate that issued the leaf. */
  intermediateDer: Buffer
  /** Leaf issued for `leafDnsName`, with `O=Codewrecks` in its subject. */
  leafDer: Buffer
  /** A second, expired leaf carrying the same DNS name, as a renewal leaves behind. */
  supersededLeafDer: Buffer
  leafDnsName: string
  /** Leaf issued by the intermediate for `*.codewrecks.com` only. */
  wildcardLeafDer: Buffer
  /**
   * A CA key rollover: the root's subject DN reissued under a new key and
   * signed by the root, carrying no key identifiers. Name comparison alone
   * cannot tell it from the root, so it exercises signature-verified issuer
   * matching.
   */
  rolloverDer: Buffer
  /** Leaf issued by `rolloverDer`, for `rolloverLeafDnsName`. */
  rolloverLeafDer: Buffer
  rolloverLeafDnsName: string
}

function writeExtensions(dir: string, name: string, lines: string[]): string {
  const file = join(dir, `${name}.ext`)
  writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

function toDer(dir: string, name: string): Buffer {
  const derFile = join(dir, `${name}.der`)
  runOpenssl(['x509', '-in', join(dir, `${name}.crt`), '-outform', 'DER', '-out', derFile])
  return readFileSync(derFile)
}

function issue(
  dir: string,
  name: string,
  subject: string,
  issuer: string,
  extensions: string[],
  days: string,
): void {
  runOpenssl([
    'req', '-new', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.csr`),
    '-subj', subject,
  ])
  runOpenssl([
    'x509', '-req', '-in', join(dir, `${name}.csr`),
    '-CA', join(dir, `${issuer}.crt`), '-CAkey', join(dir, `${issuer}.key`), '-CAcreateserial',
    '-out', join(dir, `${name}.crt`), '-days', days,
    '-extfile', writeExtensions(dir, name, extensions),
  ])
}

/**
 * A three-level chain — root, intermediate, leaf — plus a superseded leaf that
 * shares the leaf's DNS name, which is what a renewal leaves in a real store.
 * Generated rather than committed for the same reason as the single-cert
 * fixture: a private key in the repository trips secret scanning.
 */
export function createChainFixture(label: string): ChainFixture {
  const dir = join(process.cwd(), `.test-tls-chain-${label}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const leafDnsName = 'pippo.codewrecks.com'

  runOpenssl([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', join(dir, 'root.key'), '-out', join(dir, 'root.crt'),
    '-days', '2', '-subj', '/O=Codewrecks/CN=Lucifer Test Root',
  ])

  const caExtensions = [
    'basicConstraints=critical,CA:TRUE',
    'keyUsage=critical,keyCertSign,cRLSign',
    'subjectKeyIdentifier=hash',
    'authorityKeyIdentifier=keyid:always',
  ]
  issue(dir, 'intermediate', '/O=Codewrecks/CN=Lucifer Test Intermediate', 'root', caExtensions, '2')

  const leafExtensions = [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    `subjectAltName=DNS:${leafDnsName}`,
    'subjectKeyIdentifier=hash',
    'authorityKeyIdentifier=keyid:always',
  ]
  issue(dir, 'leaf', `/O=Codewrecks/CN=${leafDnsName}`, 'intermediate', leafExtensions, '2')
  // -days 0 backdates the expiry to now, so this one is outside its window.
  issue(dir, 'superseded', `/O=Codewrecks/CN=${leafDnsName}`, 'intermediate', leafExtensions, '0')

  issue(dir, 'wildcard', '/O=Codewrecks/CN=*.codewrecks.com', 'intermediate', [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'subjectAltName=DNS:*.codewrecks.com',
    'subjectKeyIdentifier=hash',
    'authorityKeyIdentifier=keyid:always',
  ], '2')

  // The rollover pair. Omitting the key identifiers is what makes
  // `X509Certificate.checkIssued` fall back to comparing names only, which is
  // how a self-issued certificate gets mistaken for a self-signed root.
  const rolloverLeafDnsName = 'rollover.codewrecks.com'
  issue(dir, 'rollover', '/O=Codewrecks/CN=Lucifer Test Root', 'root', [
    'basicConstraints=critical,CA:TRUE',
    'keyUsage=critical,keyCertSign,cRLSign',
  ], '2')
  issue(dir, 'rollover-leaf', `/O=Codewrecks/CN=${rolloverLeafDnsName}`, 'rollover', [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    `subjectAltName=DNS:${rolloverLeafDnsName}`,
  ], '2')

  return {
    dir,
    rootDer: toDer(dir, 'root'),
    intermediateDer: toDer(dir, 'intermediate'),
    leafDer: toDer(dir, 'leaf'),
    supersededLeafDer: toDer(dir, 'superseded'),
    leafDnsName,
    wildcardLeafDer: toDer(dir, 'wildcard'),
    rolloverDer: toDer(dir, 'rollover'),
    rolloverLeafDer: toDer(dir, 'rollover-leaf'),
    rolloverLeafDnsName,
  }
}

export function removeChainFixture(fixture: ChainFixture): void {
  rmSync(fixture.dir, { recursive: true, force: true })
}
