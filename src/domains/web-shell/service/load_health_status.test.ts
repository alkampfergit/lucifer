import { describe, expect, it, vi } from 'vitest'
import { loadHealthStatus } from './load_health_status'
import * as repository from '../repository/health_status_repository'

describe('loadHealthStatus', () => {
  it('delegates to the repository layer', async () => {
    const expectedStatus = {
      environment: 'test',
      name: 'lucifer',
      nodeVersion: 'v24.0.0',
      status: 'ok' as const,
      timestamp: '2026-04-06T00:00:00.000Z',
    }

    vi.spyOn(repository, 'fetchHealthStatus').mockResolvedValue(expectedStatus)

    await expect(loadHealthStatus()).resolves.toEqual(expectedStatus)
  })
})
