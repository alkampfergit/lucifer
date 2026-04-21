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

Server options:
  --config <path>    Path to lucifer.json (default: ./config/lucifer.json)
  --port <number>    Server port (default: 3001, or PORT env var)
  --data-dir <path>  Directory for SQLite database (default: ./data)
  --auto-approve     Auto-approve all commands (dev mode, no Telegram needed)
  --help             Show this help

Environment variables:
  LUCIFER_TELEGRAM_TOKEN   Telegram bot token (required for production)
  LUCIFER_TELEGRAM_CHAT_ID Telegram chat ID for approvals (or use 'pair' command)
  PORT                     Server port (default: 3001)
  LOG_LEVEL                Log level: debug, info, warn, error (default: debug / info in production)
`);
}
