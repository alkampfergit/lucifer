import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

// Resolve console stream: use pino-pretty for human-readable output in dev,
// fall back to plain JSON when pino-pretty is unavailable (e.g. npx installs).
let consoleStream: pino.DestinationStream = process.stdout;

if (!isProduction) {
  try {
    const mod = await import('pino-pretty');
    const build = typeof mod.default === 'function' ? mod.default : (mod as unknown as { build: (opts: Record<string, unknown>) => pino.DestinationStream }).build;
    consoleStream = build({ colorize: true }) as unknown as pino.DestinationStream;
  } catch {
    // pino-pretty is a devDependency — unavailable when installed via npx or in production.
    // Falls back to structured JSON on console, which is still fully functional.
  }
}

const streams = pino.multistream([
  { level: 'trace' as const, stream: consoleStream },
]);

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
}, streams);

/**
 * Add a log file destination. Logs are written as structured JSON (one object
 * per line), independent of the console format. Safe to call after startup —
 * new entries are appended; the file is created if it does not exist.
 */
export function addLogFile(filePath: string): void {
  streams.add({
    level: 'trace' as const,
    stream: pino.destination({ dest: filePath, mkdir: true, sync: false }),
  });
}

export function createChildLogger(name: string): pino.Logger {
  return logger.child({ module: name });
}
