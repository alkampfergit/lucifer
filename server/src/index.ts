import { createApp } from './create_app.js'
import { createHttpServer, listenerScheme } from './domains/platform-api/service/create_http_server.js'
import { resolveDefaultConfigPath } from './lib/config_path.js'
import { logger } from './lib/logger.js'

const configPath = resolveDefaultConfigPath()

const { app, config, tlsOptions, start, stop } = createApp(configPath ? { configPath } : {})

const server = createHttpServer(app, tlsOptions)

server.listen(config.port, async () => {
  logger.info({ port: config.port, scheme: listenerScheme(tlsOptions), configPath }, 'Lucifer listening')
  await start()
})

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down')
  await stop()
  process.exit(0)
})

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down')
  await stop()
  process.exit(0)
})
