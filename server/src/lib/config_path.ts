import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Location `--config` defaults to, and the path the Dockerfile passes. */
export const DEFAULT_CONFIG_PATH = './config/lucifer.json'

/**
 * Config path for the entrypoints that take no `--config` flag (`npm run dev`,
 * `npm start`). Without this they loaded no config file at all, so a `tls`
 * block in the default location was silently ignored and the listener stayed
 * plain HTTP.
 *
 * Resolved only when the file exists: a checkout with no config directory
 * keeps booting on built-in defaults rather than failing to start.
 */
export function resolveDefaultConfigPath(): string | undefined {
  return existsSync(resolve(DEFAULT_CONFIG_PATH)) ? DEFAULT_CONFIG_PATH : undefined
}
