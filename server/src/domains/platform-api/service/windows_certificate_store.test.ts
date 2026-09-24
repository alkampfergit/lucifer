// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { X509Certificate } from 'node:crypto'
import { exportCertificateFromWindowsStore } from './windows_certificate_store.js'
import type {
  WindowsCryptoApi,
  WindowsStoreCertificate,
} from './windows_crypto_api.js'
import type { WindowsStoreLocation, WindowsStoreSelector } from '../types/tls_config.js'
import {
  createChainFixture,
  hasOpenssl,
  removeChainFixture,
  type ChainFixture,
} from '../../../test/tls-fixtures.js'

interface StoredCertificate {
  der: Buffer
  hasPrivateKey: boolean
}

type FakeStores = Record<string, StoredCertificate[]>

interface FakeCryptoApi {
  api: WindowsCryptoApi
  exported: WindowsStoreCertificate[][]
  passphrases: string[]
  releasedHandles: unknown[]
  openedStores: string[]
}

function storeKey(location: WindowsStoreLocation, name: string): string {
  return `${location}/${name}`
}

/**
 * Stands in for `crypt32.dll`. Everything the service decides — which
 * certificate matches, which intermediates travel with it, which handles are
 * freed — is exercised against real certificates through this double, so the
 * logic is covered on every platform and not only on Windows.
 */
function fakeCryptoApi(stores: FakeStores, pfx = Buffer.from('pkcs12-bytes')): FakeCryptoApi {
  const exported: WindowsStoreCertificate[][] = []
  const passphrases: string[] = []
  const releasedHandles: unknown[] = []
  const openedStores: string[] = []

  const api: WindowsCryptoApi = {
    listCertificates(location, name) {
      const key = storeKey(location, name)
      openedStores.push(key)
      const entries = stores[key]
      if (!entries) {
        throw new Error(`Cannot open the Windows certificate store "${key}": Windows error 0x80092004`)
      }
      return entries.map((entry, index) => ({ ...entry, handle: { key, index } }))
    },
    exportPkcs12(certificates, passphrase) {
      exported.push([...certificates])
      passphrases.push(passphrase)
      return pfx
    },
    release(certificates) {
      releasedHandles.push(...certificates.map((certificate) => certificate.handle))
    },
  }

  return { api, exported, passphrases, releasedHandles, openedStores }
}

const WINDOWS = { platform: 'win32' as const }

function selector(overrides: Partial<WindowsStoreSelector>): WindowsStoreSelector {
  return { location: 'LocalMachine', name: 'My', ...overrides }
}

function fingerprints(der: Buffer): { sha1: string; sha256: string } {
  const certificate = new X509Certificate(der)
  return {
    sha1: certificate.fingerprint.replaceAll(':', '').toUpperCase(),
    sha256: certificate.fingerprint256.replaceAll(':', '').toUpperCase(),
  }
}

describe('exportCertificateFromWindowsStore', () => {
  it('refuses to run on a non-Windows platform with an actionable message', () => {
    expect(() =>
      exportCertificateFromWindowsStore(selector({ thumbprint: 'A'.repeat(40) }), {
        platform: 'linux',
        cryptoApi: fakeCryptoApi({}).api,
      }),
    ).toThrow(/only supported on Windows \(running on linux\)/)
  })

  it('never touches the certificate store on a non-Windows platform', () => {
    const fake = fakeCryptoApi({})
    expect(() =>
      exportCertificateFromWindowsStore(selector({ dnsName: 'example.test' }), {
        platform: 'linux',
        cryptoApi: fake.api,
      }),
    ).toThrow()
    expect(fake.openedStores).toEqual([])
  })
})

// The chain is generated with openssl rather than committed.
describe.skipIf(!hasOpenssl())('exportCertificateFromWindowsStore against a real chain', () => {
  let fixture: ChainFixture

  beforeAll(() => {
    fixture = createChainFixture('store')
  })

  afterAll(() => {
    removeChainFixture(fixture)
  })

  function populatedStores(overrides: Partial<FakeStores> = {}): FakeStores {
    return {
      [storeKey('LocalMachine', 'My')]: [{ der: fixture.leafDer, hasPrivateKey: true }],
      [storeKey('LocalMachine', 'CA')]: [{ der: fixture.intermediateDer, hasPrivateKey: false }],
      [storeKey('LocalMachine', 'Root')]: [{ der: fixture.rootDer, hasPrivateKey: false }],
      [storeKey('CurrentUser', 'CA')]: [],
      [storeKey('CurrentUser', 'Root')]: [],
      ...overrides,
    }
  }

  it('selects by dnsName and ships the issuing intermediate but not the root', () => {
    const fake = fakeCryptoApi(populatedStores())

    const result = exportCertificateFromWindowsStore(
      selector({ dnsName: fixture.leafDnsName }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    expect(result.pfx.toString()).toBe('pkcs12-bytes')
    expect(fake.exported).toHaveLength(1)
    const bundle = fake.exported[0].map((certificate) => certificate.der)
    expect(bundle).toEqual([fixture.leafDer, fixture.intermediateDer])
    expect(bundle).not.toContainEqual(fixture.rootDer)
  })

  it('matches a 40-character thumbprint against the SHA-1 fingerprint', () => {
    const fake = fakeCryptoApi(populatedStores())
    const { sha1 } = fingerprints(fixture.leafDer)

    const result = exportCertificateFromWindowsStore(
      selector({ thumbprint: sha1 }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    expect(result.pfx.length).toBeGreaterThan(0)
    expect(fake.exported[0][0].der).toEqual(fixture.leafDer)
  })

  it('matches a 64-character thumbprint against the SHA-256 fingerprint', () => {
    const fake = fakeCryptoApi(populatedStores())
    const { sha256 } = fingerprints(fixture.leafDer)

    exportCertificateFromWindowsStore(
      selector({ thumbprint: sha256 }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    expect(fake.exported[0][0].der).toEqual(fixture.leafDer)
  })

  it('matches a subject substring in the comma-joined rendering certmgr shows', () => {
    const fake = fakeCryptoApi(populatedStores())

    exportCertificateFromWindowsStore(
      selector({ subject: `CN=${fixture.leafDnsName}, O=Codewrecks` }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    expect(fake.exported[0][0].der).toEqual(fixture.leafDer)
  })

  it('treats a wildcard character in a subject as a literal, not as a pattern', () => {
    const fake = fakeCryptoApi(populatedStores())

    expect(() =>
      exportCertificateFromWindowsStore(
        selector({ subject: 'O=Code*' }),
        { ...WINDOWS, cryptoApi: fake.api },
      ),
    ).toThrow(/matched the configured selector/)
  })

  it('prefers the currently valid certificate when a renewal left the old one behind', () => {
    const fake = fakeCryptoApi(
      populatedStores({
        [storeKey('LocalMachine', 'My')]: [
          { der: fixture.supersededLeafDer, hasPrivateKey: true },
          { der: fixture.leafDer, hasPrivateKey: true },
        ],
      }),
    )

    exportCertificateFromWindowsStore(
      selector({ dnsName: fixture.leafDnsName }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    expect(fake.exported[0][0].der).toEqual(fixture.leafDer)
  })

  it('asks for a thumbprint when two serviceable certificates share the name', () => {
    const fake = fakeCryptoApi(
      populatedStores({
        [storeKey('LocalMachine', 'My')]: [
          { der: fixture.leafDer, hasPrivateKey: true },
          { der: fixture.leafDer, hasPrivateKey: true },
        ],
      }),
    )

    expect(() =>
      exportCertificateFromWindowsStore(
        selector({ dnsName: fixture.leafDnsName }),
        { ...WINDOWS, cryptoApi: fake.api },
      ),
    ).toThrow(/2 certificates in Cert:\\LocalMachine\\My .*use a thumbprint to disambiguate/)
  })

  it('selects a wildcard certificate by a host name it covers', () => {
    const fake = fakeCryptoApi(
      populatedStores({
        [storeKey('LocalMachine', 'My')]: [{ der: fixture.wildcardLeafDer, hasPrivateKey: true }],
      }),
    )

    exportCertificateFromWindowsStore(
      selector({ dnsName: 'Pluto.Codewrecks.com' }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    expect(fake.exported[0].map((certificate) => certificate.der)).toEqual([
      fixture.wildcardLeafDer,
      fixture.intermediateDer,
    ])
  })

  it('still selects a wildcard certificate by its literal name', () => {
    const fake = fakeCryptoApi(
      populatedStores({
        [storeKey('LocalMachine', 'My')]: [{ der: fixture.wildcardLeafDer, hasPrivateKey: true }],
      }),
    )

    exportCertificateFromWindowsStore(
      selector({ dnsName: '*.codewrecks.com' }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    expect(fake.exported[0][0].der).toEqual(fixture.wildcardLeafDer)
  })

  it('prefers the certificate issued for the exact host over a covering wildcard', () => {
    const fake = fakeCryptoApi(
      populatedStores({
        [storeKey('LocalMachine', 'My')]: [
          { der: fixture.wildcardLeafDer, hasPrivateKey: true },
          { der: fixture.leafDer, hasPrivateKey: true },
        ],
      }),
    )

    exportCertificateFromWindowsStore(
      selector({ dnsName: fixture.leafDnsName }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    expect(fake.exported[0][0].der).toEqual(fixture.leafDer)
  })

  it.each([
    ['the bare parent domain', 'codewrecks.com'],
    ['a host two labels below the wildcard', 'a.pippo.codewrecks.com'],
    ['a host under a different domain', 'pippo.example.com'],
  ])('does not let a wildcard cover %s', (_label, dnsName) => {
    const fake = fakeCryptoApi(
      populatedStores({
        [storeKey('LocalMachine', 'My')]: [{ der: fixture.wildcardLeafDer, hasPrivateKey: true }],
      }),
    )

    expect(() =>
      exportCertificateFromWindowsStore(selector({ dnsName }), { ...WINDOWS, cryptoApi: fake.api }),
    ).toThrow(/matched the configured selector/)
  })

  it('warns when the only matching certificate is outside its validity window', () => {
    const warnings: string[] = []
    const fake = fakeCryptoApi(
      populatedStores({
        [storeKey('LocalMachine', 'My')]: [{ der: fixture.supersededLeafDer, hasPrivateKey: true }],
      }),
    )

    exportCertificateFromWindowsStore(
      selector({ dnsName: fixture.leafDnsName }),
      { ...WINDOWS, cryptoApi: fake.api, warn: (message) => warnings.push(message) },
    )

    expect(fake.exported[0][0].der).toEqual(fixture.supersededLeafDer)
    expect(warnings.some((message) => message.includes('outside its validity window'))).toBe(true)
  })

  it('does not warn about validity for a current certificate', () => {
    const warnings: string[] = []
    const fake = fakeCryptoApi(populatedStores())

    exportCertificateFromWindowsStore(
      selector({ dnsName: fixture.leafDnsName }),
      { ...WINDOWS, cryptoApi: fake.api, warn: (message) => warnings.push(message) },
    )

    expect(warnings.some((message) => message.includes('validity window'))).toBe(false)
  })

  it('reports a selector that matches nothing', () => {
    const fake = fakeCryptoApi(populatedStores())

    expect(() =>
      exportCertificateFromWindowsStore(
        selector({ dnsName: 'absent.codewrecks.com' }),
        { ...WINDOWS, cryptoApi: fake.api },
      ),
    ).toThrow(/No certificate in Cert:\\LocalMachine\\My matched the configured selector/)
  })

  it('refuses a match that carries no private key', () => {
    const fake = fakeCryptoApi(
      populatedStores({
        [storeKey('LocalMachine', 'My')]: [{ der: fixture.leafDer, hasPrivateKey: false }],
      }),
    )

    expect(() =>
      exportCertificateFromWindowsStore(
        selector({ dnsName: fixture.leafDnsName }),
        { ...WINDOWS, cryptoApi: fake.api },
      ),
    ).toThrow(/has no usable private key in Cert:\\LocalMachine\\My/)
  })

  it('serves the leaf alone and warns when the issuing store cannot be read', () => {
    const warnings: string[] = []
    const fake = fakeCryptoApi({
      [storeKey('LocalMachine', 'My')]: [{ der: fixture.leafDer, hasPrivateKey: true }],
    })

    exportCertificateFromWindowsStore(
      selector({ dnsName: fixture.leafDnsName }),
      { ...WINDOWS, cryptoApi: fake.api, warn: (message) => warnings.push(message) },
    )

    expect(fake.exported[0].map((certificate) => certificate.der)).toEqual([fixture.leafDer])
    expect(warnings.some((message) => message.includes(String.raw`Cert:\LocalMachine\CA`))).toBe(true)
    expect(warnings.some((message) => message.includes('Could not read the issuing chain'))).toBe(true)
  })

  it('does not go looking for a chain when the certificate is self-signed', () => {
    const fake = fakeCryptoApi({
      [storeKey('LocalMachine', 'My')]: [{ der: fixture.rootDer, hasPrivateKey: true }],
    })

    exportCertificateFromWindowsStore(
      selector({ subject: 'CN=Lucifer Test Root' }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    expect(fake.openedStores).toEqual([storeKey('LocalMachine', 'My')])
    expect(fake.exported[0]).toHaveLength(1)
  })

  it('ships a self-issued rollover certificate instead of mistaking it for the root', () => {
    // Name comparison alone cannot separate the rollover from the root: they
    // share a subject DN and neither carries a key identifier. Only the
    // signature check keeps the rollover in the chain and the root out of it.
    const fake = fakeCryptoApi({
      [storeKey('LocalMachine', 'My')]: [{ der: fixture.rolloverLeafDer, hasPrivateKey: true }],
      [storeKey('LocalMachine', 'CA')]: [{ der: fixture.rolloverDer, hasPrivateKey: false }],
      [storeKey('LocalMachine', 'Root')]: [{ der: fixture.rootDer, hasPrivateKey: false }],
      [storeKey('CurrentUser', 'CA')]: [],
      [storeKey('CurrentUser', 'Root')]: [],
    })

    exportCertificateFromWindowsStore(
      selector({ dnsName: fixture.rolloverLeafDnsName }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    const bundle = fake.exported[0].map((certificate) => certificate.der)
    expect(bundle).toEqual([fixture.rolloverLeafDer, fixture.rolloverDer])
    expect(bundle).not.toContainEqual(fixture.rootDer)
  })

  it('ignores a same-named certificate that did not sign the leaf', () => {
    // The root shares the rollover's subject DN, so a name-only issuer search
    // can pick it; it never signed this leaf and must not end up in the chain.
    const warnings: string[] = []
    const fake = fakeCryptoApi({
      [storeKey('LocalMachine', 'My')]: [{ der: fixture.rolloverLeafDer, hasPrivateKey: true }],
      [storeKey('LocalMachine', 'CA')]: [],
      [storeKey('LocalMachine', 'Root')]: [{ der: fixture.rootDer, hasPrivateKey: false }],
      [storeKey('CurrentUser', 'CA')]: [],
      [storeKey('CurrentUser', 'Root')]: [],
    })

    exportCertificateFromWindowsStore(
      selector({ dnsName: fixture.rolloverLeafDnsName }),
      { ...WINDOWS, cryptoApi: fake.api, warn: (message) => warnings.push(message) },
    )

    expect(fake.exported[0].map((certificate) => certificate.der)).toEqual([fixture.rolloverLeafDer])
    expect(warnings.some((message) => message.includes('Could not read the issuing chain'))).toBe(true)
  })

  it('frees every handle it opened, including the chain containers', () => {
    const fake = fakeCryptoApi(populatedStores())

    exportCertificateFromWindowsStore(
      selector({ dnsName: fixture.leafDnsName }),
      { ...WINDOWS, cryptoApi: fake.api },
    )

    expect(fake.releasedHandles).toHaveLength(3)
  })

  it('frees the handles it opened even when the selector matches nothing', () => {
    const fake = fakeCryptoApi(populatedStores())

    expect(() =>
      exportCertificateFromWindowsStore(
        selector({ dnsName: 'absent.codewrecks.com' }),
        { ...WINDOWS, cryptoApi: fake.api },
      ),
    ).toThrow()

    expect(fake.releasedHandles).toHaveLength(1)
  })

  it('generates a fresh single-use passphrase per export', () => {
    const fake = fakeCryptoApi(populatedStores())
    const deps = { ...WINDOWS, cryptoApi: fake.api }

    const first = exportCertificateFromWindowsStore(selector({ dnsName: fixture.leafDnsName }), deps)
    const second = exportCertificateFromWindowsStore(selector({ dnsName: fixture.leafDnsName }), deps)

    expect(fake.passphrases[0]).not.toBe(fake.passphrases[1])
    expect(first.passphrase).toBe(fake.passphrases[0])
    expect(second.passphrase).toBe(fake.passphrases[1])
  })

  it('rejects an empty bundle instead of handing it to the listener', () => {
    const fake = fakeCryptoApi(populatedStores(), Buffer.alloc(0))

    expect(() =>
      exportCertificateFromWindowsStore(
        selector({ dnsName: fixture.leafDnsName }),
        { ...WINDOWS, cryptoApi: fake.api },
      ),
    ).toThrow(/returned no certificate data/)
  })

  it('surfaces a store that cannot be opened at all', () => {
    const fake = fakeCryptoApi({})

    expect(() =>
      exportCertificateFromWindowsStore(
        selector({ dnsName: fixture.leafDnsName }),
        { ...WINDOWS, cryptoApi: fake.api },
      ),
    ).toThrow(/Cannot open the Windows certificate store/)
  })
})
