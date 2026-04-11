// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createHealthReportService } from './create_health_report.js'

describe('createHealthReportService', () => {
  it('builds a deterministic health report shape', () => {
    const getHealthReport = createHealthReportService(
      {
        appName: 'lucifer',
        environment: 'test',
        port: 3001,
      },
      {
        getCurrentTimestamp: () => '2026-04-06T00:00:00.000Z',
        getNodeVersion: () => 'v24.0.0',
      },
    )

    expect(getHealthReport()).toEqual({
      environment: 'test',
      name: 'lucifer',
      nodeVersion: 'v24.0.0',
      status: 'ok',
      timestamp: '2026-04-06T00:00:00.000Z',
    })
  })
})
