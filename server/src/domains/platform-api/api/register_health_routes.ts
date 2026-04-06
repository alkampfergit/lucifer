import type { Express, Request, Response } from 'express'
import type { HealthReportService } from '../service/create_health_report.js'

export function registerHealthRoutes(
  app: Express,
  getHealthReport: HealthReportService,
): void {
  app.get('/api/health', (_request: Request, response: Response) => {
    response.json(getHealthReport())
  })
}
