#!/usr/bin/env node

import { getArgValue } from './cli/args.js';
import { printHelp } from './cli/print_help.js';
import { initConfig } from './cli/init_config.js';
import { runLog } from './cli/run_log.js';
import { runStats } from './cli/run_stats.js';
import { runPair } from './cli/run_pair.js';
import { runServer } from './cli/run_server.js';

const args = process.argv.slice(2);

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args[0] === '--init' || args[0] === 'init') {
    const dir = args[1] ?? '.';
    initConfig(dir);
    process.exit(0);
  }

  if (args[0] === 'pair') {
    await runPair(getArgValue(args, '--config') ?? './config/lucifer.json');
    process.exit(0);
  }

  if (args[0] === 'log') {
    const limitStr = getArgValue(args, '--limit');
    await runLog(limitStr ? parseInt(limitStr, 10) : 50, getArgValue(args, '--data-dir') ?? './data');
    process.exit(0);
  }

  if (args[0] === 'stats') {
    await runStats(getArgValue(args, '--data-dir') ?? './data');
    process.exit(0);
  }

  // Server mode — either `start` (explicit) or no subcommand (implicit).
  // Any stray unrecognised positional is treated as an error to avoid
  // silently starting the server when the user meant a subcommand.
  const first = args[0];
  if (first && first !== 'start' && !first.startsWith('-')) {
    console.error(`Unknown command: ${first}`);
    console.error(`Run 'lucifer-gate --help' for usage.`);
    process.exit(1);
  }

  await runServer({
    configPath: getArgValue(args, '--config') ?? './config/lucifer.json',
    port: getArgValue(args, '--port'),
    autoApprove: args.includes('--auto-approve'),
  });
}

try {
  await main();
} catch (err) {
  console.error('Fatal error:', err);
  process.exit(1);
}
