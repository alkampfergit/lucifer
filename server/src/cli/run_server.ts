import { createApp } from '../create_app.js';
import { createHttpServer, listenerScheme } from '../domains/platform-api/service/create_http_server.js';
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

  const { app, config, tlsOptions, start, stop } = createApp({
    configPath: options.configPath,
    autoApprove: options.autoApprove,
  });

  const server = createHttpServer(app, tlsOptions);

  server.listen(config.port, async () => {
    logger.info(
      { port: config.port, scheme: listenerScheme(tlsOptions), autoApprove: options.autoApprove },
      'Lucifer listening',
    );
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
