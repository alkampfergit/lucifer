import { createApp } from '../create_app.js';
import {
  createHttpServer,
  listenerScheme,
  listenFailureMessage,
} from '../domains/platform-api/service/create_http_server.js';
import { logger, setConsoleFormat, type LogFormat } from '../lib/logger.js';

export interface RunServerOptions {
  configPath: string;
  port?: string;
  autoApprove: boolean;
  logFormat?: LogFormat;
  logFile?: string;
}

export async function runServer(options: RunServerOptions) {
  if (options.logFormat) {
    setConsoleFormat(options.logFormat);
  }

  if (options.port) {
    process.env.PORT = options.port;
  }

  const { app, config, tlsOptions, start, stop } = createApp({
    configPath: options.configPath,
    autoApprove: options.autoApprove,
    logFile: options.logFile,
  });

  const server = createHttpServer(app, tlsOptions);

  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.fatal({ port: config.port, code: err.code }, listenFailureMessage(err, config.port));
    process.exit(1);
  });

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
