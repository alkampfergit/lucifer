// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { createApp } from '../create_app.js'
import { createHttpServer, listenerScheme } from '../domains/platform-api/service/create_http_server.js'
import { DEFAULT_HTTPS_PORT, DEFAULT_PORT } from '../domains/platform-api/config/server_config.js'
import {
  createCertificateFixture,
  hasOpenssl,
  removeCertificateFixture,
  type CertificateFixture,
} from './tls-fixtures.js'

interface BootedServer {
  port: number
  close: () => Promise<void>
}

const cleanups: Array<() => Promise<void> | void> = []
const originalPassphrase = process.env.LUCIFER_TLS_PASSPHRASE
const originalPort = process.env.PORT

/**
 * Writes a `lucifer.json`. `port` is pinned to 0 — an ephemeral port — unless
 * `omitPort` is set, which leaves the key out so the built-in default applies.
 */
function writeConfig(label: string, tls: unknown, omitPort = false): string {
  const testDir = join(process.cwd(), `.test-tls-app-${label}`)
  const configDir = join(testDir, 'config')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(join(testDir, 'data'), { recursive: true })
  cleanups.push(() => rmSync(testDir, { recursive: true, force: true }))

  const configPath = join(configDir, 'lucifer.json')
  writeFileSync(configPath, JSON.stringify({
    ...(omitPort ? {} : { port: 0 }),
    dataDir: '../data',
    ...(tls ? { tls } : {}),
  }))
  return configPath
}

async function boot(configPath: string): Promise<BootedServer & { scheme: string }> {
  const { app, tlsOptions, stop } = createApp({ configPath, autoApprove: true })
  const server = createHttpServer(app, tlsOptions)

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stop()
  }
  cleanups.push(close)

  return { port: (server.address() as AddressInfo).port, close, scheme: listenerScheme(tlsOptions) }
}

/**
 * Trusts the fixture certificate explicitly rather than turning verification
 * off: the fixture carries `IP:127.0.0.1` in its SAN, so the handshake below
 * exercises the same validation a real client performs.
 */
function getHealthOverTls(
  port: number,
  fixture: CertificateFixture,
): Promise<{ status: number; body: string; protocol: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { host: '127.0.0.1', port, path: '/api/health', ca: readFileSync(fixture.certFile) },
      (res) => {
        // Read the negotiated protocol now: the socket is detached by the
        // time the response stream ends.
        const protocol = (res.socket as TLSSocket).getProtocol() ?? ''
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, protocol }))
      },
    )
    req.on('error', reject)
  })
}

/**
 * Attempt a handshake capped at `maxVersion` and resolve with the failure. A
 * successful response is a test failure: the point of `minVersion` is that an
 * older client is turned away.
 */
function expectRefusedHandshake(
  port: number,
  fixture: CertificateFixture,
  maxVersion: 'TLSv1.2',
): Promise<Error> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { host: '127.0.0.1', port, path: '/api/health', ca: readFileSync(fixture.certFile), maxVersion },
      (res) => {
        res.resume()
        reject(new Error(`a ${maxVersion} client was served instead of being refused`))
      },
    )
    req.on('error', resolve)
  })
}

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) {
    await cleanup()
  }
  cleanups.length = 0
  if (originalPassphrase === undefined) {
    delete process.env.LUCIFER_TLS_PASSPHRASE
  } else {
    process.env.LUCIFER_TLS_PASSPHRASE = originalPassphrase
  }
  if (originalPort === undefined) {
    delete process.env.PORT
  } else {
    process.env.PORT = originalPort
  }
})

describe('gateway listener without a tls block', () => {
  it('stays plain HTTP', async () => {
    const booted = await boot(writeConfig('plain', undefined))
    expect(booted.scheme).toBe('http')
  })
})

/**
 * The port is resolved before the listener binds, so these assert on the
 * resolved value rather than binding: 443 needs privileges CI does not have.
 */
describe('default listener port', () => {
  it('stays on 3001 when no tls block is configured', () => {
    delete process.env.PORT
    const { config, stop } = createApp({
      configPath: writeConfig('default-http', undefined, true),
      autoApprove: true,
    })
    cleanups.push(stop)

    expect(config.port).toBe(DEFAULT_PORT)
  })

  it.skipIf(!hasOpenssl())('moves to 443 when a tls block is configured', () => {
    delete process.env.PORT
    const fixture = createCertificateFixture('https-default-port')
    cleanups.push(() => removeCertificateFixture(fixture))

    const { config, stop } = createApp({
      configPath: writeConfig('default-https', {
        source: 'pem',
        certFile: fixture.certFile,
        keyFile: fixture.keyFile,
      }, true),
      autoApprove: true,
    })
    cleanups.push(stop)

    expect(config.port).toBe(DEFAULT_HTTPS_PORT)
  })

  it.skipIf(!hasOpenssl())('honours an explicit port over the HTTPS default', () => {
    delete process.env.PORT
    const fixture = createCertificateFixture('https-explicit-port')
    cleanups.push(() => removeCertificateFixture(fixture))

    const { config, stop } = createApp({
      configPath: writeConfig('explicit-https-port', {
        source: 'pem',
        certFile: fixture.certFile,
        keyFile: fixture.keyFile,
      }),
      autoApprove: true,
    })
    cleanups.push(stop)

    // writeConfig pins "port": 0, which must survive the TLS default.
    expect(config.port).toBe(0)
  })
})

// The fixture certificate is generated with openssl rather than committed.
describe.skipIf(!hasOpenssl())('gateway listener with a tls block', () => {
  let fixture: CertificateFixture | undefined

  afterEach(() => {
    if (fixture) removeCertificateFixture(fixture)
    fixture = undefined
  })

  it('serves /api/health over HTTPS from a pem certificate', async () => {
    fixture = createCertificateFixture('pem')
    const booted = await boot(
      writeConfig('pem', { source: 'pem', certFile: fixture.certFile, keyFile: fixture.keyFile }),
    )

    expect(booted.scheme).toBe('https')

    const response = await getHealthOverTls(booted.port, fixture)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ok' })
    expect(['TLSv1.2', 'TLSv1.3']).toContain(response.protocol)
  })

  it('serves /api/health over HTTPS from a pfx bundle unlocked by LUCIFER_TLS_PASSPHRASE', async () => {
    fixture = createCertificateFixture('pfx')
    process.env.LUCIFER_TLS_PASSPHRASE = fixture.pfxPassphrase

    const booted = await boot(writeConfig('pfx', { source: 'pfx', pfxFile: fixture.pfxFile }))

    const response = await getHealthOverTls(booted.port, fixture)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ok' })
  })

  it('negotiates TLS 1.3 and turns a TLS 1.2 client away when minVersion is TLSv1.3', async () => {
    fixture = createCertificateFixture('min-version')
    const booted = await boot(
      writeConfig('min-version', {
        source: 'pem',
        certFile: fixture.certFile,
        keyFile: fixture.keyFile,
        minVersion: 'TLSv1.3',
      }),
    )

    const response = await getHealthOverTls(booted.port, fixture)
    expect(response.protocol).toBe('TLSv1.3')

    const refusal = await expectRefusedHandshake(booted.port, fixture, 'TLSv1.2')
    expect(refusal.message).toMatch(/version|protocol|EPROTO|alert/i)
  })

  it('still completes the handshake when a caFile chain is appended to the certificate', async () => {
    fixture = createCertificateFixture('chain')
    const chainFile = join(fixture.dir, 'chain.pem')
    writeFileSync(chainFile, readFileSync(fixture.certFile))

    const booted = await boot(
      writeConfig('chain', {
        source: 'pem',
        certFile: fixture.certFile,
        keyFile: fixture.keyFile,
        caFile: chainFile,
      }),
    )

    const response = await getHealthOverTls(booted.port, fixture)
    expect(response.status).toBe(200)
  })

  it('fails startup with a descriptive error when the certificate is missing', () => {
    const configPath = writeConfig('missing', {
      source: 'pem',
      certFile: join(process.cwd(), 'does-not-exist.crt'),
      keyFile: join(process.cwd(), 'does-not-exist.key'),
    })

    expect(() => createApp({ configPath, autoApprove: true })).toThrow(/does not exist/)
  })
})
