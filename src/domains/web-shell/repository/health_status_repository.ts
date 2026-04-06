import { getApiBaseUrl } from '../config/api_config'
import { isHealthStatus, type HealthStatus } from '../types/health_status'

function buildApiUrl(pathname: string): string {
  const apiBaseUrl = getApiBaseUrl()

  return `${apiBaseUrl}${pathname}`
}

export async function fetchHealthStatus(): Promise<HealthStatus> {
  const response = await fetch(buildApiUrl('/api/health'))

  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}`)
  }

  const payload: unknown = await response.json()

  if (!isHealthStatus(payload)) {
    throw new Error('Health response did not match the expected contract')
  }

  return payload
}
