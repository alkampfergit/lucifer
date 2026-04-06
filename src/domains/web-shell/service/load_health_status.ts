import { fetchHealthStatus } from '../repository/health_status_repository'
import type { HealthStatus } from '../types/health_status'

export async function loadHealthStatus(): Promise<HealthStatus> {
  return fetchHealthStatus()
}
