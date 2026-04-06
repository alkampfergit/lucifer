import type { ServerConfig } from '../config/server_config.js'
import type { RuntimeMetadataRepository } from '../repository/runtime_metadata_repository.js'
import type { HealthReport } from '../types/health_report.js'

export type HealthReportService = () => HealthReport

export function createHealthReportService(
  config: ServerConfig,
  metadataRepository: RuntimeMetadataRepository,
): HealthReportService {
  return () => ({
    environment: config.environment,
    name: config.appName,
    nodeVersion: metadataRepository.getNodeVersion(),
    status: 'ok',
    timestamp: metadataRepository.getCurrentTimestamp(),
  })
}
