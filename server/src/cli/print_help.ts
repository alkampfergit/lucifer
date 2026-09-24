export function printHelp() {
  console.log(`
lucifer-gate - AI Agent Command Firewall

Usage:
  lucifer-gate start [options]        Start the server (explicit form)
  lucifer-gate [options]              Start the server (implicit, same as 'start')
  lucifer-gate --init [dir]           Generate starter config files
  lucifer-gate pair [--config <path>] Pair a Telegram chat for approvals
  lucifer-gate log [--limit N]        Query audit log
  lucifer-gate stats                  Show approval statistics
  lucifer-gate --version              Print the installed version

Server options:
  --config <path>    Path to lucifer.json (default: ./config/lucifer.json)
  --port <number>    Server port (--port, then PORT, then lucifer.json; defaults to 3001 HTTP / 443 HTTPS)
  --auto-approve     Auto-approve all commands (dev mode, no Telegram needed)
  --log-format <fmt> Console log format: pretty (default) or json (also LOG_FORMAT)
  --log-file <path>  Also write JSON-lines logs to <path> (overrides "logFile" in lucifer.json)

Audit query options ('log' and 'stats'):
  --data-dir <path>  Directory holding the SQLite database (default: ./data)
  --limit <number>   Number of audit entries to print ('log' only, default: 50)

Anywhere:
  --help, -h         Show this help
  --version, -v      Print the installed version and exit

Environment variables:
  LUCIFER_TELEGRAM_TOKEN   Telegram bot token (required for production)
  LUCIFER_TELEGRAM_CHAT_ID Telegram chat ID for approvals (or use 'pair' command)
  PORT                     Server port (default: 3001 HTTP / 443 HTTPS)
  LOG_LEVEL                Log level: debug, info, warn, error (default: debug / info in production)
  LOG_FORMAT               Console log format: pretty or json (default: pretty; --log-format wins)
`);
}
