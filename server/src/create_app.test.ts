// @vitest-environment node
import request from 'supertest'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from './create_app.js'
import { hashApiKey } from './domains/command-gateway/repository/api_key_store.js'
import { closeDatabase } from './domains/command-gateway/repository/database.js'

describe('createApp', () => {
  it('serves the health endpoint', async () => {
    const { app } = createApp()

    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body.name).toBe('lucifer')
    expect(response.body.status).toBe('ok')
  })
})

describe('createApp boot scenarios', () => {
  const tempDirs: string[] = []

  function makeTempDir(label: string): string {
    const dir = join(tmpdir(), `lucifer-boot-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(dir, { recursive: true })
    tempDirs.push(dir)
    return dir
  }

  afterEach(async () => {
    closeDatabase()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
    vi.unstubAllEnvs()
  })

  it('boots without config files — gateway disabled, health works, execute 404', async () => {
    const tempDir = makeTempDir('no-config')
    const dataDir = join(tempDir, 'data')
    mkdirSync(dataDir, { recursive: true })

    const configPath = join(tempDir, 'lucifer.json')
    writeFileSync(configPath, JSON.stringify({ port: 0, dataDir: './data' }))

    // No api-keys.json or command-rules.json — gateway should be disabled
    const { app, stop } = createApp({ configPath })

    const healthRes = await request(app).get('/api/health')
    expect(healthRes.status).toBe(200)
    expect(healthRes.body.status).toBe('ok')

    // Execute endpoint should not be registered
    const execRes = await request(app).post('/api/v1/execute').send({ command: 'echo hi' })
    expect(execRes.status).toBe(404)

    await stop()
  })

  it('boots with valid config + autoApprove — gateway enabled, execute works', async () => {
    const tempDir = makeTempDir('auto-approve')
    const dataDir = join(tempDir, 'data')
    mkdirSync(dataDir, { recursive: true })

    const testKey = 'luc_boottest789'
    const testSalt = 'bootsalt12345678'
    const testHash = hashApiKey(testKey, testSalt)

    writeFileSync(join(tempDir, 'lucifer.json'), JSON.stringify({
      port: 0,
      approvalTimeoutSeconds: 5,
      executionTimeoutSeconds: 10,
      maxConcurrentExecutions: 3,
      maxOutputBytes: 1024,
      rateLimitPerMinute: 100,
      onApprovalTimeout: 'deny',
      dataDir: './data',
    }))

    writeFileSync(join(tempDir, 'api-keys.json'), JSON.stringify({
      keys: [{
        id: 'boot-test',
        name: 'boot-integration',
        keyHash: testHash,
        salt: testSalt,
        allowedIps: [],
        createdAt: new Date().toISOString(),
        active: true,
      }],
    }))

    writeFileSync(join(tempDir, 'command-rules.json'), JSON.stringify({
      rules: [
        { prefix: 'echo ', action: 'always_approve' },
      ],
      defaultAction: 'always_deny',
    }))

    const configPath = join(tempDir, 'lucifer.json')
    const { app, start, stop } = createApp({ configPath, autoApprove: true })
    await start()

    const execRes = await request(app)
      .post('/api/v1/execute')
      .set('x-api-key', testKey)
      .send({ command: 'echo boot-test' })

    expect(execRes.status).toBe(200)
    expect(execRes.body.status).toBe('completed')
    expect(execRes.body.stdout).toContain('boot-test')

    await stop()
  })

  it('throws on malformed lucifer.json (port as string)', () => {
    const tempDir = makeTempDir('malformed')

    const configPath = join(tempDir, 'lucifer.json')
    writeFileSync(configPath, JSON.stringify({ port: 'banana' }))

    // Also write valid api-keys.json and command-rules.json so the gateway would try to init
    writeFileSync(join(tempDir, 'api-keys.json'), JSON.stringify({
      keys: [],
    }))

    writeFileSync(join(tempDir, 'command-rules.json'), JSON.stringify({
      rules: [],
      defaultAction: 'always_deny',
    }))

    expect(() => createApp({ configPath })).toThrow()
  })

  it('throws without LUCIFER_TELEGRAM_TOKEN when autoApprove is false', () => {
    const tempDir = makeTempDir('no-token')
    const dataDir = join(tempDir, 'data')
    mkdirSync(dataDir, { recursive: true })

    writeFileSync(join(tempDir, 'lucifer.json'), JSON.stringify({
      port: 0,
      dataDir: './data',
    }))

    writeFileSync(join(tempDir, 'api-keys.json'), JSON.stringify({
      keys: [{
        id: 'token-test',
        name: 'token-integration',
        keyHash: 'fakehash',
        salt: 'fakesalt',
        allowedIps: [],
        createdAt: new Date().toISOString(),
        active: true,
      }],
    }))

    writeFileSync(join(tempDir, 'command-rules.json'), JSON.stringify({
      rules: [],
      defaultAction: 'always_deny',
    }))

    // Ensure token env var is not set
    delete process.env.LUCIFER_TELEGRAM_TOKEN

    const configPath = join(tempDir, 'lucifer.json')
    expect(() => createApp({ configPath })).toThrow('LUCIFER_TELEGRAM_TOKEN')
  })
})
