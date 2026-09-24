import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import {
  DEFAULT_HTTPS_PORT,
  getServerConfig,
  resolveListenerPort,
  type ServerConfig,
} from './domains/platform-api/config/server_config.js'
import { loadTlsConfig } from './domains/platform-api/config/tls_config.js'
import { resolveTlsOptions } from './domains/platform-api/service/resolve_tls_options.js'
import type { ResolvedTlsOptions } from './domains/platform-api/types/tls_config.js'
import { registerHealthRoutes } from './domains/platform-api/api/register_health_routes.js'
import { createRuntimeMetadataRepository } from './domains/platform-api/repository/runtime_metadata_repository.js'
import { createHealthReportService } from './domains/platform-api/service/create_health_report.js'
import { loadGatewayConfig } from './domains/command-gateway/config/gateway_config.js'
import { getDatabase, closeDatabase, resolveDatabasePath } from './domains/command-gateway/repository/database.js'
import { resolveAdminSessionKey, deriveInstanceId, AdminSessionKeyConfigError } from './domains/command-gateway/repository/admin_session_key_store.js'
import { createApprovalStore } from './domains/command-gateway/repository/approval_store.js'
import { createAuditLog } from './domains/command-gateway/repository/audit_log.js'
import { createApiKeyStore } from './domains/command-gateway/repository/api_key_store.js'
import { createCommandRulesStore } from './domains/command-gateway/repository/command_rules_store.js'
import { createPendingRequestStore } from './domains/command-gateway/repository/pending_request_store.js'
import { registerExecuteRoutes } from './domains/command-gateway/api/register_execute_routes.js'
import { createTelegramApprovalChannel } from './domains/command-gateway/service/request_telegram_approval.js'
import { createAutoApproveChannel } from './domains/command-gateway/service/auto_approve_channel.js'
import { createWebApprovalChannel } from './domains/command-gateway/service/web_approval_channel.js'
import { createMultiApprovalChannel } from './domains/command-gateway/service/multi_approval_channel.js'
import { registerApprovalRoutes } from './domains/command-gateway/api/register_approval_routes.js'
import { createAdminSessionSealer, type AdminSessionSealer } from './domains/command-gateway/service/admin_session.js'
import type { ApprovalChannel } from './domains/command-gateway/types/command_types.js'
import { loadProxyConfig, validateProxyPorts } from './domains/request-proxy/config/proxy_config.js'
import { createProxyServers, type ProxyServerDeps, type ProxyServers } from './domains/request-proxy/service/proxy_server.js'
import type {
  ProxyApprovalContext,
  ProxyApprovalOutcome,
  ProxyApprovalRequester,
  ProxyAuditSink,
  ProxyTokenValidator,
} from './domains/request-proxy/types/proxy_types.js'
import { createChildLogger, addLogFile } from './lib/logger.js'

const log = createChildLogger('app')

export interface CreateAppOptions {
  configPath?: string
  autoApprove?: boolean
  telegramApiRoot?: string
  /** JSON-lines log file from `--log-file`; overrides `logFile` in lucifer.json. Resolved against the working directory. */
  logFile?: string
}

interface GatewayDeps {
  app: ReturnType<typeof express>
  db: ReturnType<typeof getDatabase>
  pendingStore: ReturnType<typeof createPendingRequestStore>
  approvalStore: ReturnType<typeof createApprovalStore>
  auditLog: ReturnType<typeof createAuditLog>
  gatewayConfig: ReturnType<typeof loadGatewayConfig>
}

/**
 * Build the cookie sealer for the admin UI, unless the operator turned the
 * feature off. A key that cannot be resolved is not fatal: the web channel
 * still works, callers just have to re-enter the admin secret each time.
 *
 * Both the stored key and the sealed audience are scoped to this deployment's
 * database path, so a second instance on the same host cannot be signed into
 * with the first one's cookie.
 *
 * The one exception is a malformed `LUCIFER_ADMIN_COOKIE_KEY`. That is the
 * operator saying "use *this* key", so degrading to bearer-only would hide a
 * configuration mistake behind a feature that merely looks switched off — the
 * documented contract is a startup error, and this is where it is honoured.
 */
function initAdminSessionSealer(
  db: ReturnType<typeof getDatabase>,
  gatewayConfig: ReturnType<typeof loadGatewayConfig>,
): AdminSessionSealer | undefined {
  if (gatewayConfig.adminCookieSession?.enabled === false) {
    log.info('Admin cookie sessions disabled by config; admin auth is bearer-only')
    return undefined
  }

  // One identifier for both halves of the scoping: the keychain entry that
  // holds the key, and the `aud` claim that says which deployment a session
  // belongs to. They must agree, so they are derived once here.
  const instanceId = deriveInstanceId(resolveDatabasePath(gatewayConfig.dataDir))

  try {
    const { key, source } = resolveAdminSessionKey(db, instanceId)
    log.info({ source, instanceId }, 'Admin cookie sessions enabled')
    return createAdminSessionSealer(key, { audience: instanceId })
  } catch (err) {
    if (err instanceof AdminSessionKeyConfigError) throw err
    log.error({ err }, 'Could not resolve the admin session key; admin auth stays bearer-only')
    return undefined
  }
}

function initApprovalChannel(deps: GatewayDeps, autoApprove: boolean, telegramApiRoot?: string): ApprovalChannel {
  if (autoApprove) {
    return createAutoApproveChannel()
  }

  const channels: ApprovalChannel[] = []
  const { app, db, pendingStore, approvalStore, auditLog, gatewayConfig } = deps

  const telegramToken = process.env.LUCIFER_TELEGRAM_TOKEN
  const chatId = gatewayConfig.telegramChatId ?? process.env.LUCIFER_TELEGRAM_CHAT_ID
  if (telegramToken && chatId) {
    const telegramOptions = telegramApiRoot ? { apiRoot: telegramApiRoot } : undefined
    channels.push(createTelegramApprovalChannel(telegramToken, chatId, pendingStore, approvalStore, auditLog, telegramOptions))
  }

  const adminSecretHash = gatewayConfig.adminSecretHash
  const adminSecretSalt = gatewayConfig.adminSecretSalt
  if (adminSecretHash && adminSecretSalt) {
    const webChannel = createWebApprovalChannel()
    channels.push(webChannel)
    const adminSession = initAdminSessionSealer(db, gatewayConfig)
    registerApprovalRoutes({ router: app, adminSecretHash, adminSecretSalt, webChannel, approvalStore, auditLog, adminSession })
    log.info('Web approval UI enabled at /admin/approvals')
  }

  if (channels.length === 0) {
    throw new Error(
      'No approval channels configured. Set LUCIFER_TELEGRAM_TOKEN + LUCIFER_TELEGRAM_CHAT_ID for Telegram, ' +
      'or run --init to generate admin secret for web UI, or use --auto-approve for development.',
    )
  }

  return channels.length === 1 ? channels[0] : createMultiApprovalChannel(channels)
}

/**
 * Adapter from the command-gateway ApiKeyStore to the proxy-domain
 * ProxyTokenValidator contract. Kept in this composition file so
 * `request-proxy` never imports from `command-gateway`.
 */
function createProxyTokenValidator(apiKeyStore: ReturnType<typeof createApiKeyStore>): ProxyTokenValidator {
  return {
    validate(rawToken: string) {
      const entry = apiKeyStore.findByKey(rawToken)
      if (!entry) return undefined
      return { keyId: entry.id, keyName: entry.name }
    },
  }
}

/**
 * Adapter from the command-gateway ApprovalChannel to the proxy-domain
 * ProxyApprovalRequester contract. Synthesises a human-readable descriptor
 * as the "command" string and races against an approval timeout so the
 * proxy request cannot block indefinitely waiting for a human.
 */
function createProxyApprovalRequester(
  approvalChannel: ApprovalChannel,
  approvalTimeoutSeconds: number,
): ProxyApprovalRequester {
  return {
    async request(ctx: ProxyApprovalContext): Promise<ProxyApprovalOutcome> {
      const descriptor = `HTTP proxy ${ctx.method} ${ctx.path} (port ${ctx.port}) by ${ctx.keyName}`
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), approvalTimeoutSeconds * 1000)
      })

      try {
        const approvalPromise = approvalChannel
          .requestApproval(descriptor, ctx.keyName, ctx.ip, ctx.requestId, { level: 'safe', warnings: [] })
          .then((r): 'approved' | 'denied' => (r.decision === 'approved' ? 'approved' : 'denied'))

        const outcome = await Promise.race<ProxyApprovalOutcome>([approvalPromise, timeoutPromise])

        if (outcome === 'timeout') {
          approvalChannel.cancel?.(ctx.requestId)
        }
        return outcome
      } catch (err) {
        log.warn({ err, requestId: ctx.requestId }, 'Proxy approval channel threw')
        return 'error'
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
  }
}

/**
 * Adapter from proxy audit events to the command-gateway audit log, so
 * proxy auth/approval activity shows up in `lucifer-gate log` alongside
 * command activity.
 */
function createProxyAuditSink(auditLog: ReturnType<typeof createAuditLog>): ProxyAuditSink {
  return {
    record(event) {
      try {
        auditLog.append({
          ts: event.ts,
          type: event.type,
          requestId: event.requestId,
          command: `HTTP proxy ${event.method} ${event.path} (port ${event.port})`,
          apiKeyName: event.keyName,
          ip: event.ip,
          approvedBy: event.source,
          error: event.reason,
        })
      } catch (err) {
        log.warn({ err }, 'Failed to write proxy audit event')
      }
    },
  }
}

interface ConfigPaths {
  configDir: string
  apiKeysPath: string
  commandRulesPath: string
  proxyConfigPath: string
}

function resolveConfigPaths(configPath: string | undefined): ConfigPaths {
  const configDir = configPath ? path.dirname(path.resolve(configPath)) : process.cwd()
  return {
    configDir,
    apiKeysPath: path.join(configDir, 'api-keys.json'),
    commandRulesPath: path.join(configDir, 'command-rules.json'),
    proxyConfigPath: path.join(configDir, 'proxy-config.json'),
  }
}

function enableFileLogging(
  gatewayConfig: ReturnType<typeof loadGatewayConfig>,
  resolvedDataDir: string,
  logFileOverride: string | undefined,
) {
  const logPath = logFileOverride
    ? path.resolve(logFileOverride)
    : gatewayConfig.logFile && path.resolve(resolvedDataDir, gatewayConfig.logFile)
  if (!logPath) return
  addLogFile(logPath)
  log.info({ logFile: logPath }, 'File logging enabled')
}

interface GatewayWiring {
  approvalChannel: ApprovalChannel
  cleanupInterval: ReturnType<typeof setInterval>
  proxyDeps: ProxyServerDeps
}

function wireCommandGateway(
  app: ReturnType<typeof express>,
  gatewayConfig: ReturnType<typeof loadGatewayConfig>,
  paths: ConfigPaths,
  options: CreateAppOptions,
): GatewayWiring {
  const db = getDatabase(gatewayConfig.dataDir)
  const approvalStore = createApprovalStore(db)
  const auditLog = createAuditLog(db)
  const apiKeyStore = createApiKeyStore(paths.apiKeysPath)
  const commandRulesStore = createCommandRulesStore(paths.commandRulesPath)
  const pendingStore = createPendingRequestStore()

  const approvalChannel = initApprovalChannel(
    { app, db, pendingStore, approvalStore, auditLog, gatewayConfig },
    options.autoApprove ?? false,
    options.telegramApiRoot,
  )

  registerExecuteRoutes({
    router: app, config: gatewayConfig, apiKeyStore, commandRulesStore,
    approvalStore, pendingStore, auditLog, approvalChannel,
  })

  const cleanupInterval = setInterval(() => {
    approvalStore.removeExpired()
    pendingStore.cleanup(gatewayConfig.approvalTimeoutSeconds * 1000)
  }, 60_000)

  // Wire the proxy bridges over gateway stores so request-proxy stays
  // isolated from command-gateway code (Dependency Rules).
  const proxyDeps: ProxyServerDeps = {
    tokenValidator: createProxyTokenValidator(apiKeyStore),
    approvalRequester: createProxyApprovalRequester(approvalChannel, gatewayConfig.approvalTimeoutSeconds),
    auditSink: createProxyAuditSink(auditLog),
  }

  log.info('Command gateway initialized')
  return { approvalChannel, cleanupInterval, proxyDeps }
}

function wireProxyServers(
  proxyConfigPath: string,
  gatewayPort: number,
  proxyDeps: ProxyServerDeps,
): ProxyServers | undefined {
  const proxyConfig = loadProxyConfig(proxyConfigPath)
  if (!proxyConfig || proxyConfig.proxies.length === 0) return undefined
  validateProxyPorts(proxyConfig.proxies, gatewayPort)
  const proxyServers = createProxyServers(proxyConfig.proxies, proxyDeps)
  log.info({ count: proxyConfig.proxies.length }, 'Transparent proxy mappings configured')
  return proxyServers
}

/**
 * Read the optional `tls` block and load the certificate material it names.
 * Resolved here rather than at listen time so a misconfigured certificate
 * fails during startup, with the offending file named.
 */
function resolveListenerTls(configPath: string | undefined): ResolvedTlsOptions | undefined {
  const tlsConfig = loadTlsConfig(configPath)
  if (!tlsConfig) return undefined
  const tlsOptions = resolveTlsOptions(tlsConfig)
  log.info({ source: tlsConfig.source, minVersion: tlsConfig.minVersion }, 'TLS enabled for the gateway listener')
  return tlsOptions
}

export function createApp(options: CreateAppOptions = {}) {
  const tlsOptions = resolveListenerTls(options.configPath)
  const gatewayConfig = loadGatewayConfig(
    options.configPath,
    tlsOptions ? DEFAULT_HTTPS_PORT : undefined,
  )

  // One port for everything downstream: the listener the entrypoints bind, the
  // health report, and the proxy collision check. Before this they disagreed —
  // the check validated against `lucifer.json`'s `port` while the listener
  // bound `PORT`, so a proxy mapping could take the gateway's own port unseen.
  const listenerPort = resolveListenerPort(gatewayConfig.port)
  gatewayConfig.port = listenerPort

  const serverConfig: ServerConfig = { ...getServerConfig(), port: listenerPort }
  const metadataRepository = createRuntimeMetadataRepository()
  const getHealthReport = createHealthReportService(serverConfig, metadataRepository)
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json())
  registerHealthRoutes(app, getHealthReport)

  const paths = resolveConfigPaths(options.configPath)

  // Off unless the operator names their proxy. Express defaults `trust proxy`
  // to false, and that default is what keeps `req.secure` (and therefore the
  // `Secure` flag on admin session cookies) unspoofable by a direct client.
  if (gatewayConfig.trustProxy !== undefined) {
    app.set('trust proxy', gatewayConfig.trustProxy)
    log.info({ trustProxy: gatewayConfig.trustProxy }, 'Trusting forwarding headers from configured proxies')
  }

  // Resolve dataDir relative to config directory
  gatewayConfig.dataDir = path.resolve(paths.configDir, gatewayConfig.dataDir)

  enableFileLogging(gatewayConfig, gatewayConfig.dataDir, options.logFile)

  let approvalChannel: ApprovalChannel | undefined
  let cleanupInterval: ReturnType<typeof setInterval> | undefined
  let proxyDeps: ProxyServerDeps = {}

  if (fs.existsSync(paths.apiKeysPath) && fs.existsSync(paths.commandRulesPath)) {
    const wiring = wireCommandGateway(app, gatewayConfig, paths, options)
    approvalChannel = wiring.approvalChannel
    cleanupInterval = wiring.cleanupInterval
    proxyDeps = wiring.proxyDeps
  } else {
    log.warn(
      { apiKeysPath: paths.apiKeysPath, commandRulesPath: paths.commandRulesPath },
      'Config files not found. Run with --init to generate them. Gateway disabled.',
    )
  }

  if (process.env.NODE_ENV === 'production' && !tlsOptions) {
    log.warn('Ensure HTTPS is configured for production. API keys are transmitted in headers.')
  }

  const proxyServers = wireProxyServers(paths.proxyConfigPath, gatewayConfig.port, proxyDeps)

  async function start() {
    // All-or-nothing: if any later step fails, roll back earlier ones so
    // callers never observe a half-started app (e.g. Telegram bot polling
    // while the proxy port failed to bind).
    const started: Array<() => Promise<void>> = []
    try {
      if (approvalChannel) {
        await approvalChannel.start()
        started.push(() => approvalChannel!.stop())
      }
      if (proxyServers) {
        await proxyServers.start()
        started.push(() => proxyServers!.stop())
      }
    } catch (err) {
      for (const rollback of started.reverse()) {
        try { await rollback() } catch (rollbackErr) {
          log.warn({ err: rollbackErr }, 'Error rolling back partial startup')
        }
      }
      throw err
    }
  }

  async function stop() {
    if (cleanupInterval) clearInterval(cleanupInterval)
    if (approvalChannel) {
      try { await approvalChannel.stop() } catch (err) {
        log.warn({ err }, 'Error stopping approval channel')
      }
    }
    if (proxyServers) {
      try { await proxyServers.stop() } catch (err) {
        log.warn({ err }, 'Error stopping proxy servers')
      }
    }
    closeDatabase()
  }

  return { app, config: serverConfig, gatewayConfig, tlsOptions, start, stop }
}
