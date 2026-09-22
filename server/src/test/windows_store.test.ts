// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { createApp } from '../create_app.js'
import { createHttpServer, listenerScheme } from '../domains/platform-api/service/create_http_server.js'

/**
 * End-to-end cover for `"source": "windows-store"`: it boots the real listener
 * from a certificate that really lives in the Windows certificate store, read
 * through the native CryptoAPI binding.
 *
 * The certificate is planted by the Windows CI job (see `.github/workflows/ci.yml`),
 * which exports the public half to a PEM file and publishes these three
 * variables. Without them — on Linux, or on a developer machine that has not
 * run the setup — the whole block is skipped rather than failing.
 */
const dnsName = process.env.LUCIFER_TEST_WINDOWS_STORE_DNS_NAME
const thumbprint = process.env.LUCIFER_TEST_WINDOWS_STORE_THUMBPRINT
const certificatePem = process.env.LUCIFER_TEST_WINDOWS_STORE_CERT_PEM
const enabled =
  process.platform === 'win32' && Boolean(dnsName) && Boolean(thumbprint) && Boolean(certificatePem)

/**
 * The second CI certificate: a leaf under `root -> intermediate -> leaf`, with
 * both issuers left in the store containers as public-only copies.
 */
const chainDnsName = process.env.LUCIFER_TEST_WINDOWS_STORE_CHAIN_DNS_NAME
const chainRootPem = process.env.LUCIFER_TEST_WINDOWS_STORE_CHAIN_ROOT_PEM
const chainEnabled = enabled && Boolean(chainDnsName) && Boolean(chainRootPem)

const cleanups: Array<() => Promise<void> | void> = []

function writeConfig(label: string, store: Record<string, unknown>): string {
  const testDir = join(process.cwd(), `.test-tls-store-${label}`)
  const configDir = join(testDir, 'config')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(join(testDir, 'data'), { recursive: true })
  cleanups.push(() => rmSync(testDir, { recursive: true, force: true }))

  const configPath = join(configDir, 'lucifer.json')
  writeFileSync(
    configPath,
    JSON.stringify({ port: 0, dataDir: '../data', tls: { source: 'windows-store', store } }),
  )
  return configPath
}

async function boot(configPath: string): Promise<{ port: number; scheme: string }> {
  const { app, tlsOptions, stop } = createApp({ configPath, autoApprove: true })
  const server = createHttpServer(app, tlsOptions)

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stop()
  })

  return { port: (server.address() as AddressInfo).port, scheme: listenerScheme(tlsOptions) }
}

/**
 * Trusts the planted certificate explicitly and asks for it by name, so the
 * handshake performs the same validation a real client would rather than
 * skipping it.
 */
function getHealthOverTls(
  port: number,
  servername: string = dnsName as string,
  caPath: string = certificatePem as string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: '127.0.0.1',
        port,
        path: '/api/health',
        servername,
        ca: readFileSync(caPath),
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', reject)
  })
}

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) {
    await cleanup()
  }
  cleanups.length = 0
})

describe.skipIf(!enabled)('gateway listener backed by the Windows certificate store', () => {
  it('serves /api/health over HTTPS from a certificate selected by dnsName', async () => {
    const booted = await boot(
      writeConfig('dns', { location: 'CurrentUser', name: 'My', dnsName }),
    )

    expect(booted.scheme).toBe('https')

    const response = await getHealthOverTls(booted.port)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ok' })
  })

  it('serves the same certificate when it is selected by thumbprint', async () => {
    const booted = await boot(
      writeConfig('thumbprint', { location: 'CurrentUser', name: 'My', thumbprint }),
    )

    const response = await getHealthOverTls(booted.port)
    expect(response.status).toBe(200)
  })

  it('fails startup with a descriptive error when nothing in the store matches', () => {
    const configPath = writeConfig('absent', {
      location: 'CurrentUser',
      name: 'My',
      dnsName: 'absent.lucifer-ci.test',
    })

    expect(() => createApp({ configPath, autoApprove: true })).toThrow(
      /matched the configured selector/,
    )
  })
})

describe.skipIf(!chainEnabled)('gateway listener backed by a chained store certificate', () => {
  it('sends the issuing intermediate so a client holding only the root can validate', async () => {
    const booted = await boot(
      writeConfig('chain', { location: 'CurrentUser', name: 'My', dnsName: chainDnsName }),
    )

    expect(booted.scheme).toBe('https')

    // The client trusts the root and nothing else. It can only build a path to
    // it if the listener sent the intermediate alongside the leaf — which in
    // turn means the store export staged a certificate that has no private key.
    const response = await getHealthOverTls(
      booted.port,
      chainDnsName as string,
      chainRootPem as string,
    )

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ok' })
  })
})
