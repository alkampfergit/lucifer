// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveTlsOptions } from './resolve_tls_options.js'
import type { TlsConfig } from '../types/tls_config.js'

const dirs: string[] = []
const originalPassphrase = process.env.LUCIFER_TLS_PASSPHRASE

function createDir(label: string): string {
  const dir = join(process.cwd(), `.test-tls-resolve-${label}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function writeFile(dir: string, name: string, body: string): string {
  const filePath = join(dir, name)
  writeFileSync(filePath, body)
  return filePath
}

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  dirs.length = 0
  if (originalPassphrase === undefined) {
    delete process.env.LUCIFER_TLS_PASSPHRASE
  } else {
    process.env.LUCIFER_TLS_PASSPHRASE = originalPassphrase
  }
})

describe('resolveTlsOptions', () => {
  it('reads the pem material and omits an unset passphrase', () => {
    delete process.env.LUCIFER_TLS_PASSPHRASE
    const dir = createDir('pem')
    const config: TlsConfig = {
      source: 'pem',
      minVersion: 'TLSv1.3',
      certFile: writeFile(dir, 'server.crt', 'CERT'),
      keyFile: writeFile(dir, 'server.key', 'KEY'),
    }

    const options = resolveTlsOptions(config)

    expect(options.cert?.toString()).toBe('CERT')
    expect(options.key?.toString()).toBe('KEY')
    expect(options.minVersion).toBe('TLSv1.3')
    expect(options).not.toHaveProperty('ca')
    expect(options).not.toHaveProperty('passphrase')
  })

  it('appends the chain bundle to the certificate so clients actually receive it', () => {
    // `ca` on a server is the trust store for client certificates and is never
    // sent to a client; intermediates only travel as part of `cert`.
    const dir = createDir('pem-ca')
    const options = resolveTlsOptions({
      source: 'pem',
      minVersion: 'TLSv1.2',
      certFile: writeFile(dir, 'server.crt', 'CERT\n'),
      keyFile: writeFile(dir, 'server.key', 'KEY'),
      caFile: writeFile(dir, 'chain.pem', 'CHAIN'),
    })

    expect(options.cert?.toString()).toBe('CERT\nCHAIN')
    expect(options).not.toHaveProperty('ca')
  })

  it('separates the chain from a certificate file that does not end in a newline', () => {
    const dir = createDir('pem-ca-nonewline')
    const options = resolveTlsOptions({
      source: 'pem',
      minVersion: 'TLSv1.2',
      certFile: writeFile(dir, 'server.crt', 'CERT'),
      keyFile: writeFile(dir, 'server.key', 'KEY'),
      caFile: writeFile(dir, 'chain.pem', 'CHAIN'),
    })

    expect(options.cert?.toString()).toBe('CERT\nCHAIN')
  })

  it('takes the pfx passphrase from the environment, not from the config file', () => {
    process.env.LUCIFER_TLS_PASSPHRASE = 'from-env'
    const dir = createDir('pfx')

    const options = resolveTlsOptions({
      source: 'pfx',
      minVersion: 'TLSv1.2',
      pfxFile: writeFile(dir, 'server.pfx', 'PFX'),
    })

    expect(options.pfx?.toString()).toBe('PFX')
    expect(options.passphrase).toBe('from-env')
  })

  it('names the file it could not read', () => {
    const dir = createDir('missing')
    expect(() =>
      resolveTlsOptions({
        source: 'pem',
        minVersion: 'TLSv1.2',
        certFile: join(dir, 'gone.crt'),
        keyFile: writeFile(dir, 'server.key', 'KEY'),
      }),
    ).toThrow(/Cannot read TLS "certFile" at .*gone\.crt/)
  })

  it('uses the ephemeral export passphrase for a windows-store certificate', () => {
    const options = resolveTlsOptions(
      {
        source: 'windows-store',
        minVersion: 'TLSv1.2',
        store: { location: 'LocalMachine', name: 'My', thumbprint: 'A'.repeat(40) },
      },
      {
        platform: 'win32',
        runPowerShell: (_script, env) => ({
          status: 0,
          stdout: Buffer.from(`bundle:${env.LUCIFER_TLS_EXPORT_PASSWORD}`).toString('base64'),
          stderr: '',
        }),
      },
    )

    expect(options.pfx?.toString()).toBe(`bundle:${options.passphrase}`)
  })

  it('fails on a non-Windows host rather than silently serving plain HTTP', () => {
    expect(() =>
      resolveTlsOptions(
        {
          source: 'windows-store',
          minVersion: 'TLSv1.2',
          store: { location: 'LocalMachine', name: 'My', thumbprint: 'A'.repeat(40) },
        },
        { platform: 'linux' },
      ),
    ).toThrow(/only supported on Windows/)
  })
})
