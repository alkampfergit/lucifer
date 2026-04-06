export interface HealthStatus {
  environment: string
  name: string
  nodeVersion: string
  status: 'ok'
  timestamp: string
}

export function isHealthStatus(value: unknown): value is HealthStatus {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    candidate.status === 'ok' &&
    typeof candidate.environment === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.nodeVersion === 'string' &&
    typeof candidate.timestamp === 'string'
  )
}
