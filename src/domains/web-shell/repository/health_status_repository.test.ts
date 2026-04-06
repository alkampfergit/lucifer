import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHealthStatus } from './health_status_repository'

describe('fetchHealthStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the validated health status payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          environment: 'test',
          name: 'lucifer',
          nodeVersion: 'v24.0.0',
          status: 'ok',
          timestamp: '2026-04-06T00:00:00.000Z',
        }),
      }),
    )

    await expect(fetchHealthStatus()).resolves.toEqual({
      environment: 'test',
      name: 'lucifer',
      nodeVersion: 'v24.0.0',
      status: 'ok',
      timestamp: '2026-04-06T00:00:00.000Z',
    })
  })

  it('rejects invalid payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'oops' }),
      }),
    )

    await expect(fetchHealthStatus()).rejects.toThrow(
      'Health response did not match the expected contract',
    )
  })
})
