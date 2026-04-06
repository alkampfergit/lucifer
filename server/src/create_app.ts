import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { getServerConfig } from './domains/platform-api/config/server_config.js'
import { registerHealthRoutes } from './domains/platform-api/api/register_health_routes.js'
import { createRuntimeMetadataRepository } from './domains/platform-api/repository/runtime_metadata_repository.js'
import { createHealthReportService } from './domains/platform-api/service/create_health_report.js'

export function createApp() {
  const config = getServerConfig()
  const metadataRepository = createRuntimeMetadataRepository()
  const getHealthReport = createHealthReportService(config, metadataRepository)
  const app = express()
  const indexPath = path.join(config.clientDistPath, 'index.html')
  const hasBuiltClient = fs.existsSync(indexPath)
  const indexMarkup = hasBuiltClient ? fs.readFileSync(indexPath, 'utf8') : null

  app.disable('x-powered-by')
  app.use(express.json())
  registerHealthRoutes(app, getHealthReport)

  if (hasBuiltClient && indexMarkup !== null) {
    app.use(express.static(config.clientDistPath))
    app.get(/^(?!\/api\/).*/, (_request, response) => {
      response.type('html').send(indexMarkup)
    })
  }

  return { app, config }
}
