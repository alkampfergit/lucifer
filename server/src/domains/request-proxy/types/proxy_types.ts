/**
 * A single transparent-proxy mapping. One mapping = one listener on its own
 * port that forwards every incoming request to `baseUrl`, preserving the
 * request path, method, query string and body, and injecting the configured
 * `headers` on the outgoing request.
 */
export interface ProxyMapping {
  port: number;
  baseUrl: string;
  headers?: Record<string, string>;
}

export interface ProxyConfig {
  proxies: ProxyMapping[];
}
