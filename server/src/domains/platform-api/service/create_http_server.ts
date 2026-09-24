import http from 'node:http'
import https from 'node:https'
import type { ResolvedTlsOptions } from '../types/tls_config.js'

/**
 * Wrap the composed request handler in a listener. With TLS configured the
 * listener speaks HTTPS only — there is no companion plain-HTTP port, so a
 * client that forgets the scheme fails loudly instead of sending its API key
 * in clear text.
 */
export function createHttpServer(
  handler: http.RequestListener,
  tlsOptions?: ResolvedTlsOptions,
): http.Server | https.Server {
  return tlsOptions ? https.createServer(tlsOptions, handler) : http.createServer(handler)
}

/** URL scheme the listener will answer on, for startup logs and docs. */
export function listenerScheme(tlsOptions?: ResolvedTlsOptions): 'http' | 'https' {
  return tlsOptions ? 'https' : 'http'
}

const PORT_SETTINGS = 'set --port, PORT or "port" in lucifer.json'

/**
 * Turn a failed bind into a message naming the port and the way out. Without
 * it the operator gets an uncaught `EACCES` stack trace — easy to hit now that
 * a `tls` block with no port set defaults the listener to the privileged 443.
 */
export function listenFailureMessage(err: NodeJS.ErrnoException, port: number): string {
  switch (err.code) {
    case 'EACCES':
      return `Cannot bind port ${port}: permission denied. Ports below 1024 need elevated privileges; ` +
        `run with them or ${PORT_SETTINGS} to an unprivileged port.`
    case 'EADDRINUSE':
      return `Cannot bind port ${port}: it is already in use by another process; stop it or ${PORT_SETTINGS}.`
    default:
      return `Cannot bind port ${port}: ${err.message}`
  }
}
