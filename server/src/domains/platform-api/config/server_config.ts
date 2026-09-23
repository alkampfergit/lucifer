export interface ServerConfig {
  appName: string
  environment: string
  port: number
}

/** Bound when neither `PORT` nor `lucifer.json` names a port. */
export const DEFAULT_PORT = 3001
/** Bound when TLS is enabled and neither `PORT` nor `lucifer.json` names a port. */
export const DEFAULT_HTTPS_PORT = 443

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) return undefined

  const parsedPort = Number.parseInt(value, 10)
  if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
    return parsedPort
  }

  return undefined
}

/**
 * The port the listener actually binds.
 *
 * `PORT` — which the CLI's `--port` flag sets — wins over the `port` in
 * `lucifer.json`, so a flag can override a checked-in config file; the file
 * wins over the built-in default. One resolver so the port the server binds
 * and the port the proxy collision check validates against cannot disagree.
 */
export function resolveListenerPort(filePort?: number): number {
  return parsePort(process.env.PORT) ?? filePort ?? DEFAULT_PORT
}

export function getServerConfig(): ServerConfig {
  return {
    appName: 'lucifer',
    environment: process.env.NODE_ENV ?? 'development',
    port: resolveListenerPort(),
  }
}
