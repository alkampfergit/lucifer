/**
 * A single transparent-proxy mapping. One mapping = one listener on its own
 * port that forwards every incoming request to `baseUrl`, preserving the
 * request path, method, query string and body, and injecting the configured
 * `headers` on the outgoing request.
 *
 * `host` controls the bind address. Defaults to `127.0.0.1` so a
 * credentialed proxy is not inadvertently exposed to the network — set it
 * explicitly (e.g. `"0.0.0.0"`) to opt into broader binding.
 */
export interface ProxyMapping {
  port: number;
  baseUrl: string;
  headers?: Record<string, string>;
  host?: string;
}

export const DEFAULT_PROXY_HOST = '127.0.0.1';

export interface ProxyConfig {
  proxies: ProxyMapping[];
}
