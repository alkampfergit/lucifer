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

export function createApp(options: CreateAppOptions = {}) {
  const serverConfig = getServerConfig()
  const metadataRepository = createRuntimeMetadataRepository()
  const getHealthReport = createHealthReportService(serverConfig, metadataRepository)
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json())
  registerHealthRoutes(app, getHealthReport)

  // Initialize Lucifer command gateway
  const gatewayConfig = loadGatewayConfig(options.configPath)
  const configDir = options.configPath ? path.dirname(path.resolve(options.configPath)) : process.cwd()
  const apiKeysPath = path.join(configDir, 'api-keys.json')
  const commandRulesPath = path.join(configDir, 'command-rules.json')
  const proxyConfigPath = path.join(configDir, 'proxy-config.json')

  // Resolve dataDir relative to config directory
  const resolvedDataDir = path.resolve(configDir, gatewayConfig.dataDir)
  gatewayConfig.dataDir = resolvedDataDir

  // Enable file logging (logFile is relative to dataDir)
  if (gatewayConfig.logFile) {
    const logPath = path.resolve(resolvedDataDir, gatewayConfig.logFile)
    addLogFile(logPath)
    log.info({ logFile: logPath }, 'File logging enabled')
  }

  let approvalChannel: ApprovalChannel | undefined
  let cleanupInterval: ReturnType<typeof setInterval> | undefined
  const proxyDeps: ProxyServerDeps = {}

  // Only initialize gateway if config files exist
  if (fs.existsSync(apiKeysPath) && fs.existsSync(commandRulesPath)) {
    const db = getDatabase(gatewayConfig.dataDir)
    const approvalStore = createApprovalStore(db)
    const auditLog = createAuditLog(db)
    const apiKeyStore = createApiKeyStore(apiKeysPath)
    const commandRulesStore = createCommandRulesStore(commandRulesPath)
    const pendingStore = createPendingRequestStore()

    approvalChannel = initApprovalChannel(
      { app, pendingStore, approvalStore, auditLog, gatewayConfig },
      options.autoApprove ?? false,
      options.telegramApiRoot,
    )

    registerExecuteRoutes({
      router: app, config: gatewayConfig, apiKeyStore, commandRulesStore,
      approvalStore, pendingStore, auditLog, approvalChannel,
    })

    // Clean up expired approvals and stale pending requests periodically
    cleanupInterval = setInterval(() => {
      approvalStore.removeExpired()
      pendingStore.cleanup(gatewayConfig.approvalTimeoutSeconds * 1000)
    }, 60_000)

    // Wire the proxy bridges over gateway stores so request-proxy stays
    // isolated from command-gateway code (Dependency Rules).
    proxyDeps.tokenValidator = createProxyTokenValidator(apiKeyStore)
    proxyDeps.approvalRequester = createProxyApprovalRequester(approvalChannel, gatewayConfig.approvalTimeoutSeconds)
    proxyDeps.auditSink = createProxyAuditSink(auditLog)

    log.info('Command gateway initialized')
  } else {
    log.warn({ apiKeysPath, commandRulesPath }, 'Config files not found. Run with --init to generate them. Gateway disabled.')
  }

  // TLS warning
  if (process.env.NODE_ENV === 'production') {
    log.warn('Ensure HTTPS is configured for production. API keys are transmitted in headers.')
  }

  // Transparent proxy listeners (optional, separate from the gateway port)
  let proxyServers: ProxyServers | undefined
  const proxyConfig = loadProxyConfig(proxyConfigPath)
  if (proxyConfig && proxyConfig.proxies.length > 0) {
    validateProxyPorts(proxyConfig.proxies, gatewayConfig.port)
    proxyServers = createProxyServers(proxyConfig.proxies, proxyDeps)
    log.info({ count: proxyConfig.proxies.length }, 'Transparent proxy mappings configured')
  }

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
