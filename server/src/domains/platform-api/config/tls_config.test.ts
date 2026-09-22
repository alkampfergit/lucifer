// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadTlsConfig } from './tls_config.js'

const dirs: string[] = []

function createConfigDir(label: string): string {
  const dir = join(process.cwd(), `.test-tls-config-${label}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  // Existence is all the loader checks; parsing happens in the service layer.
  writeFileSync(join(dir, 'server.crt'), 'cert')
  writeFileSync(join(dir, 'server.key'), 'key')
  writeFileSync(join(dir, 'chain.pem'), 'chain')
  writeFileSync(join(dir, 'server.pfx'), 'pfx')
  return dir
}

function writeConfig(dir: string, body: unknown): string {
  const configPath = join(dir, 'lucifer.json')
  writeFileSync(configPath, JSON.stringify(body))
  return configPath
}

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  dirs.length = 0
})

describe('loadTlsConfig', () => {
  it('returns undefined when no config path is given', () => {
    expect(loadTlsConfig(undefined)).toBeUndefined()
  })

  it('returns undefined when lucifer.json has no tls block', () => {
    const dir = createConfigDir('absent')
    expect(loadTlsConfig(writeConfig(dir, { port: 3001 }))).toBeUndefined()
  })

  it('resolves pem paths against the config directory and defaults minVersion', () => {
    const dir = createConfigDir('pem')
    const configPath = writeConfig(dir, {
      tls: { source: 'pem', certFile: 'server.crt', keyFile: 'server.key' },
    })

    expect(loadTlsConfig(configPath)).toEqual({
      source: 'pem',
      minVersion: 'TLSv1.2',
      certFile: join(dir, 'server.crt'),
      keyFile: join(dir, 'server.key'),
    })
  })

  it('keeps an optional caFile and an explicit minVersion', () => {
    const dir = createConfigDir('pem-ca')
    const configPath = writeConfig(dir, {
      tls: {
        source: 'pem',
        certFile: 'server.crt',
        keyFile: 'server.key',
        caFile: 'chain.pem',
        minVersion: 'TLSv1.3',
      },
    })

    expect(loadTlsConfig(configPath)).toMatchObject({
      caFile: join(dir, 'chain.pem'),
      minVersion: 'TLSv1.3',
    })
  })

  it('resolves a pfx path', () => {
    const dir = createConfigDir('pfx')
    const configPath = writeConfig(dir, { tls: { source: 'pfx', pfxFile: 'server.pfx' } })

    expect(loadTlsConfig(configPath)).toEqual({
      source: 'pfx',
      minVersion: 'TLSv1.2',
      pfxFile: join(dir, 'server.pfx'),
    })
  })

  it('normalises a spaced thumbprint and defaults the store location and name', () => {
    const dir = createConfigDir('store')
    const configPath = writeConfig(dir, {
      tls: { source: 'windows-store', store: { thumbprint: 'a1b2c3d4 e5f60718 293a4b5c 6d7e8f90 a1b2c3d4' } },
    })

    expect(loadTlsConfig(configPath)).toEqual({
      source: 'windows-store',
      minVersion: 'TLSv1.2',
      store: {
        location: 'LocalMachine',
        name: 'My',
        thumbprint: 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4',
      },
    })
  })

  it('accepts a subject selector with an explicit location and store name', () => {
    const dir = createConfigDir('store-subject')
    const configPath = writeConfig(dir, {
      tls: {
        source: 'windows-store',
        store: { location: 'CurrentUser', name: 'Root', subject: 'CN=lucifer.example.com' },
      },
    })

    expect(loadTlsConfig(configPath)).toMatchObject({
      store: { location: 'CurrentUser', name: 'Root', subject: 'CN=lucifer.example.com' },
    })
  })

  it('accepts a dns name selector and trims it', () => {
    const dir = createConfigDir('store-dns')
    const configPath = writeConfig(dir, {
      tls: { source: 'windows-store', store: { dnsName: ' pippo.codewrecks.com ' } },
    })

    expect(loadTlsConfig(configPath)).toEqual({
      source: 'windows-store',
      minVersion: 'TLSv1.2',
      store: { location: 'LocalMachine', name: 'My', dnsName: 'pippo.codewrecks.com' },
    })
  })

  it('accepts a wildcard dns name', () => {
    const dir = createConfigDir('store-dns-wildcard')
    const configPath = writeConfig(dir, {
      tls: { source: 'windows-store', store: { dnsName: '*.codewrecks.com' } },
    })

    expect(loadTlsConfig(configPath)).toMatchObject({ store: { dnsName: '*.codewrecks.com' } })
  })

  it.each([
    ['an unknown source', { source: 'acme' }, /"source" must be one of/],
    ['a missing keyFile', { source: 'pem', certFile: 'server.crt' }, /"keyFile" is required/],
    ['a certFile that does not exist', { source: 'pem', certFile: 'nope.crt', keyFile: 'server.key' }, /does not exist/],
    ['an unsupported minVersion', { source: 'pfx', pfxFile: 'server.pfx', minVersion: 'TLSv1.1' }, /"minVersion" must be/],
    ['fields from another source', { source: 'pfx', pfxFile: 'server.pfx', certFile: 'server.crt' }, /only valid with "source": "pem"/],
    ['a missing store', { source: 'windows-store' }, /"store" is required/],
    ['a store with neither selector', { source: 'windows-store', store: { name: 'My' } }, /exactly one of/],
    ['a store with both selectors', { source: 'windows-store', store: { thumbprint: 'A'.repeat(40), subject: 'CN=x' } }, /exactly one of/],
    ['a store with a thumbprint and a dns name', { source: 'windows-store', store: { thumbprint: 'A'.repeat(40), dnsName: 'a.example.com' } }, /exactly one of/],
    ['a blank dns name', { source: 'windows-store', store: { dnsName: '   ' } }, /"store.dnsName" must be a non-empty string/],
    ['a non-string dns name', { source: 'windows-store', store: { dnsName: 42 } }, /"store.dnsName" must be a non-empty string/],
    ['a dns name that is not a host name', { source: 'windows-store', store: { dnsName: 'CN=pippo, O=codewrecks' } }, /must be a host name/],
    ['a dns name with an empty label', { source: 'windows-store', store: { dnsName: 'pippo..com' } }, /must be a host name/],
    ['an over-long dns name', { source: 'windows-store', store: { dnsName: `${'a'.repeat(60)}.`.repeat(5) } }, /must be a host name/],
    ['a malformed thumbprint', { source: 'windows-store', store: { thumbprint: 'not-hex' } }, /hex certificate thumbprint/],
    ['an unknown store location', { source: 'windows-store', store: { location: 'Machine', thumbprint: 'A'.repeat(40) } }, /"store.location" must be/],
    ['an explicit null minVersion', { source: 'pfx', pfxFile: 'server.pfx', minVersion: null }, /"minVersion" must be/],
    ['an explicit null store location', { source: 'windows-store', store: { location: null, thumbprint: 'A'.repeat(40) } }, /"store.location" must be/],
    ['an explicit null store name', { source: 'windows-store', store: { name: null, thumbprint: 'A'.repeat(40) } }, /"store.name" must be/],
    ['a non-object tls block', 'yes', /expected an object/],
  ])('rejects %s', (_label, tls, expected) => {
    const dir = createConfigDir(`invalid-${String(_label).replaceAll(/\W/g, '')}`)
    expect(() => loadTlsConfig(writeConfig(dir, { tls }))).toThrow(expected)
  })
})
