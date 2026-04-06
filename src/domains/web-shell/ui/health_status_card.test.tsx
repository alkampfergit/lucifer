import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HealthStatusCard } from './health_status_card'

describe('HealthStatusCard', () => {
  it('renders health metadata when data is available', () => {
    render(
      <HealthStatusCard
        errorMessage={null}
        healthStatus={{
          environment: 'test',
          name: 'lucifer',
          nodeVersion: 'v24.0.0',
          status: 'ok',
          timestamp: '2026-04-06T00:00:00.000Z',
        }}
        isLoading={false}
      />, 
    )

    expect(screen.getByText('Application health')).toBeInTheDocument()
    expect(screen.getByText('lucifer')).toBeInTheDocument()
    expect(screen.getByText('test')).toBeInTheDocument()
  })
})
