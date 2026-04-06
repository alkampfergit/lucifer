import type { HealthStatus } from '../types/health_status'

type HealthStatusCardProps = {
  errorMessage: string | null
  healthStatus: HealthStatus | null
  isLoading: boolean
}

export function HealthStatusCard({
  errorMessage,
  healthStatus,
  isLoading,
}: HealthStatusCardProps) {
  if (isLoading) {
    return (
      <article className="status-card">
        <h2>Application health</h2>
        <p className="status-loading">Loading platform status…</p>
      </article>
    )
  }

  if (errorMessage !== null) {
    return (
      <article className="status-card">
        <h2>Application health</h2>
        <p className="status-error">{errorMessage}</p>
      </article>
    )
  }

  if (healthStatus === null) {
    return (
      <article className="status-card">
        <h2>Application health</h2>
        <p className="status-error">Health status is unavailable.</p>
      </article>
    )
  }

  return (
    <article className="status-card">
      <h2>Application health</h2>
      <p className="status-badge">{healthStatus.status.toUpperCase()}</p>
      <dl className="status-meta">
        <div>
          <dt>Service</dt>
          <dd>{healthStatus.name}</dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd>{healthStatus.environment}</dd>
        </div>
        <div>
          <dt>Node version</dt>
          <dd>{healthStatus.nodeVersion}</dd>
        </div>
        <div>
          <dt>Timestamp</dt>
          <dd>{new Date(healthStatus.timestamp).toLocaleString()}</dd>
        </div>
      </dl>
    </article>
  )
}
