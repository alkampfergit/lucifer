import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { getServerConfig } from './domains/platform-api/config/server_config.js'
import { registerHealthRoutes } from './domains/platform-api/api/register_health_routes.js'
import { createRuntimeMetadataRepository } from './domains/platform-api/repository/runtime_metadata_repository.js'
import { createHealthReportService } from './domains/platform-api/service/create_health_report.js'
import { loadGatewayConfig } from './domains/command-gateway/config/gateway_config.js'
import { getDatabase, closeDatabase } from './domains/command-gateway/repository/database.js'
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
}

interface GatewayDeps {
  app: ReturnType<typeof express>
  pendingStore: ReturnType<typeof createPendingRequestStore>
  approvalStore: ReturnType<typeof createApprovalStore>
  auditLog: ReturnType<typeof createAuditLog>
  gatewayConfig: ReturnType<typeof loadGatewayConfig>
}

function initApprovalChannel(deps: GatewayDeps, autoApprove: boolean, telegramApiRoot?: string): ApprovalChannel {
  if (autoApprove) {
    return createAutoApproveChannel()
  }

  const channels: ApprovalChannel[] = []
  const { app, pendingStore, approvalStore, auditLog, gatewayConfig } = deps

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
    registerApprovalRoutes({ router: app, adminSecretHash, adminSecretSalt, webChannel, approvalStore, auditLog })
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

function enableFileLoggingIfConfigured(gatewayConfig: ReturnType<typeof loadGatewayConfig>, resolvedDataDir: string) {
  if (!gatewayConfig.logFile) return
  const logPath = path.resolve(resolvedDataDir, gatewayConfig.logFile)
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
    { app, pendingStore, approvalStore, auditLog, gatewayConfig },
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

export function createApp(options: CreateAppOptions = {}) {
  const serverConfig = getServerConfig()
  const metadataRepository = createRuntimeMetadataRepository()
  const getHealthReport = createHealthReportService(serverConfig, metadataRepository)
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json())
  registerHealthRoutes(app, getHealthReport)

  const gatewayConfig = loadGatewayConfig(options.configPath)
  const paths = resolveConfigPaths(options.configPath)

  // Resolve dataDir relative to config directory
  gatewayConfig.dataDir = path.resolve(paths.configDir, gatewayConfig.dataDir)

  enableFileLoggingIfConfigured(gatewayConfig, gatewayConfig.dataDir)

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

  if (process.env.NODE_ENV === 'production') {
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

  return { app, config: serverConfig, gatewayConfig, start, stop }
}
