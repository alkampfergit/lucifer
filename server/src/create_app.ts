import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { getServerConfig } from './domains/platform-api/config/server_config.js'
import { registerHealthRoutes } from './domains/platform-api/api/register_health_routes.js'
import { createRuntimeMetadataRepository } from './domains/platform-api/repository/runtime_metadata_repository.js'
import { createHealthReportService } from './domains/platform-api/service/create_health_report.js'
import { loadGatewayConfig, getTelegramToken } from './domains/command-gateway/config/gateway_config.js'
import { getDatabase, closeDatabase } from './domains/command-gateway/repository/database.js'
import { createApprovalStore } from './domains/command-gateway/repository/approval_store.js'
import { createAuditLog } from './domains/command-gateway/repository/audit_log.js'
import { createApiKeyStore } from './domains/command-gateway/repository/api_key_store.js'
import { createCommandRulesStore } from './domains/command-gateway/repository/command_rules_store.js'
import { createPendingRequestStore } from './domains/command-gateway/repository/pending_request_store.js'
import { registerExecuteRoutes } from './domains/command-gateway/api/register_execute_routes.js'
import { createTelegramApprovalChannel } from './domains/command-gateway/service/request_telegram_approval.js'
import { createAutoApproveChannel } from './domains/command-gateway/service/auto_approve_channel.js'
import type { ApprovalChannel } from './domains/command-gateway/types/command_types.js'
import { createChildLogger } from './lib/logger.js'

const log = createChildLogger('app')

export interface CreateAppOptions {
  configPath?: string
  autoApprove?: boolean
}

export function createApp(options: CreateAppOptions = {}) {
  const serverConfig = getServerConfig()
  const metadataRepository = createRuntimeMetadataRepository()
  const getHealthReport = createHealthReportService(serverConfig, metadataRepository)
  const app = express()
  const indexPath = path.join(serverConfig.clientDistPath, 'index.html')
  const hasBuiltClient = fs.existsSync(indexPath)
  const indexMarkup = hasBuiltClient ? fs.readFileSync(indexPath, 'utf8') : null

  app.disable('x-powered-by')
  app.use(express.json())
  registerHealthRoutes(app, getHealthReport)

  // Initialize Lucifer command gateway
  const gatewayConfig = loadGatewayConfig(options.configPath)
  const configDir = options.configPath ? path.dirname(path.resolve(options.configPath)) : process.cwd()
  const apiKeysPath = path.join(configDir, 'api-keys.json')
  const commandRulesPath = path.join(configDir, 'command-rules.json')

  // Resolve dataDir relative to config directory
  const resolvedDataDir = path.resolve(configDir, gatewayConfig.dataDir)
  gatewayConfig.dataDir = resolvedDataDir

  let approvalChannel: ApprovalChannel | undefined
  let cleanupInterval: ReturnType<typeof setInterval> | undefined

  // Only initialize gateway if config files exist
  if (fs.existsSync(apiKeysPath) && fs.existsSync(commandRulesPath)) {
    const db = getDatabase(gatewayConfig.dataDir)
    const approvalStore = createApprovalStore(db)
    const auditLog = createAuditLog(db)
    const apiKeyStore = createApiKeyStore(apiKeysPath)
    const commandRulesStore = createCommandRulesStore(commandRulesPath)
    const pendingStore = createPendingRequestStore()

    if (options.autoApprove) {
      approvalChannel = createAutoApproveChannel()
    } else {
      const token = getTelegramToken()
      const chatId = gatewayConfig.telegramChatId ?? process.env.LUCIFER_TELEGRAM_CHAT_ID
      if (!chatId) {
        throw new Error(
          'Telegram chat ID is required. Set LUCIFER_TELEGRAM_CHAT_ID env var or telegramChatId in config.',
        )
      }
      approvalChannel = createTelegramApprovalChannel(token, chatId, pendingStore, approvalStore, auditLog)
    }

    registerExecuteRoutes({
      router: app, config: gatewayConfig, apiKeyStore, commandRulesStore,
      approvalStore, pendingStore, auditLog, approvalChannel,
    })

    // Clean up expired approvals and stale pending requests periodically
    cleanupInterval = setInterval(() => {
      approvalStore.removeExpired()
      pendingStore.cleanup(gatewayConfig.approvalTimeoutSeconds * 1000)
    }, 60_000)

    log.info('Command gateway initialized')
  } else {
    log.warn({ apiKeysPath, commandRulesPath }, 'Config files not found. Run with --init to generate them. Gateway disabled.')
  }

  // TLS warning
  if (process.env.NODE_ENV === 'production') {
    log.warn('Ensure HTTPS is configured for production. API keys are transmitted in headers.')
  }

  if (hasBuiltClient && indexMarkup !== null) {
    app.use(express.static(serverConfig.clientDistPath))
    app.get(/^(?!\/api\/).*/, (_request, response) => {
      response.type('html').send(indexMarkup)
    })
  }

  async function start() {
    if (approvalChannel) {
      await approvalChannel.start()
    }
  }

  async function stop() {
    if (cleanupInterval) clearInterval(cleanupInterval)
    if (approvalChannel) await approvalChannel.stop()
    closeDatabase()
  }

  return { app, config: serverConfig, gatewayConfig, start, stop }
}
