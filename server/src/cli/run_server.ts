import { createApp } from '../create_app.js';
import { logger } from '../lib/logger.js';

export interface RunServerOptions {
  configPath: string;
  port?: string;
  autoApprove: boolean;
}

export async function runServer(options: RunServerOptions) {
  if (options.port) {
    process.env.PORT = options.port;
  }

  const { app, config, start, stop } = createApp({
    configPath: options.configPath,
    autoApprove: options.autoApprove,
  });

  const server = app.listen(config.port, async () => {
    logger.info({ port: config.port, autoApprove: options.autoApprove }, 'Lucifer listening');
    await start();
  });

  const shutdown = async () => {
    logger.info('Shutting down');
    await stop();
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
