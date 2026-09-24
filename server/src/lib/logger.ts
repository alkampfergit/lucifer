import pino from 'pino';
import pretty from 'pino-pretty';

const isProduction = process.env.NODE_ENV === 'production';

export const LOG_FORMATS = ['pretty', 'json'] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/** Returns the format named by `value`, or `undefined` when it is not one. */
export function parseLogFormat(value: string | undefined): LogFormat | undefined {
  return LOG_FORMATS.find((format) => format === value);
}

/**
 * Build the console stream for a format. `pretty` renders one line per entry,
 * e.g. `[07:49:54] INFO: (app) Command gateway initialized`, colourised only
 * when stdout is a TTY; `json` writes pino's structured lines unchanged.
 */
export function createConsoleStream(format: LogFormat): pino.DestinationStream {
  if (format === 'json') return process.stdout;
  return pretty({
    colorize: process.stdout.isTTY === true,
    translateTime: 'SYS:HH:MM:ss',
    ignore: 'pid,hostname,module',
    messageFormat: '{if module}({module}) {end}{msg}',
    sync: true,
  });
}

// The console format can be chosen after this module has loaded (the CLI
// parses `--log-format` after its imports run), so the multistream writes to
// a forwarding stream whose target can be swapped.
let consoleTarget = createConsoleStream(parseLogFormat(process.env.LOG_FORMAT) ?? 'pretty');
const consoleStream: pino.DestinationStream = {
  write: (chunk: string) => consoleTarget.write(chunk),
};

const streams = pino.multistream([
  { level: 'info' as const, stream: consoleStream },
]);

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
}, streams);

const unknownFormat = process.env.LOG_FORMAT;
if (unknownFormat && !parseLogFormat(unknownFormat)) {
  logger.warn({ LOG_FORMAT: unknownFormat }, `Unknown LOG_FORMAT, expected one of: ${LOG_FORMATS.join(', ')}; using pretty`);
}

/** Switch the console between human-readable and JSON output. */
export function setConsoleFormat(format: LogFormat): void {
  consoleTarget = createConsoleStream(format);
}

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
