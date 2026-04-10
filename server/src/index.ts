import { createApp } from './create_app.js'
import { logger } from './lib/logger.js'

const { app, config, start, stop } = createApp()

app.listen(config.port, async () => {
  logger.info({ port: config.port }, 'Lucifer listening')
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
