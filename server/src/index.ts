import { createApp } from './create_app.js'
import {
  createHttpServer,
  listenerScheme,
  listenFailureMessage,
} from './domains/platform-api/service/create_http_server.js'
import { resolveDefaultConfigPath } from './lib/config_path.js'
import { logger, warnOnUnknownLogFormatEnv } from './lib/logger.js'

warnOnUnknownLogFormatEnv()

const configPath = resolveDefaultConfigPath()

const { app, config, tlsOptions, start, stop } = createApp(configPath ? { configPath } : {})

const server = createHttpServer(app, tlsOptions)

server.on('error', (err: NodeJS.ErrnoException) => {
  logger.fatal({ port: config.port, code: err.code }, listenFailureMessage(err, config.port))
  process.exit(1)
})

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
