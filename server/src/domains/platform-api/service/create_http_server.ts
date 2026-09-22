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
