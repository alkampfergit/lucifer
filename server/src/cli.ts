#!/usr/bin/env node

import { findUnknownOption, getArgValue } from './cli/args.js';
import { DEFAULT_CONFIG_PATH } from './lib/config_path.js';
import { printHelp } from './cli/print_help.js';
import { printVersion } from './cli/print_version.js';
import { initConfig } from './cli/init_config.js';
import { runLog } from './cli/run_log.js';
import { runStats } from './cli/run_stats.js';
import { runPair } from './cli/run_pair.js';
import { runServer } from './cli/run_server.js';
import { LOG_FORMATS, parseLogFormat } from './lib/logger.js';

const args = process.argv.slice(2);

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Answered before anything reads a config file: asking which build is
  // installed must work from any directory, including one with no config.
  if (args.includes('--version') || args.includes('-v')) {
    printVersion();
    process.exit(0);
  }

  if (args[0] === '--init' || args[0] === 'init') {
    const dir = args[1] ?? '.';
    initConfig(dir);
    process.exit(0);
  }

  if (args[0] === 'pair') {
    await runPair(getArgValue(args, '--config') ?? DEFAULT_CONFIG_PATH);
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

  // An unrecognised option is an error for the same reason: otherwise a typo
  // starts the server, and a missing config turns that into a stack trace that
  // says nothing about the option the operator actually got wrong.
  const unknownOption = findUnknownOption(args, {
    valueFlags: ['--config', '--port', '--log-format', '--log-file'],
    booleanFlags: ['--auto-approve'],
  });
  if (unknownOption) {
    console.error(`Unknown option: ${unknownOption}`);
    console.error(`Run 'lucifer-gate --help' for usage.`);
    process.exit(1);
  }

  // A value flag given as the last argument has no value; reject it rather
  // than silently starting with the default.
  const missingValue = ['--log-format', '--log-file'].find(
    (flag) => args.includes(flag) && getArgValue(args, flag) === undefined,
  );
  if (missingValue) {
    console.error(`Missing value for ${missingValue}`);
    console.error(`Run 'lucifer-gate --help' for usage.`);
    process.exit(1);
  }

  const logFormatArg = getArgValue(args, '--log-format');
  const logFormat = parseLogFormat(logFormatArg);
  if (logFormatArg !== undefined && !logFormat) {
    console.error(`Invalid --log-format: ${logFormatArg} (expected one of: ${LOG_FORMATS.join(', ')})`);
    process.exit(1);
  }

  await runServer({
    configPath: getArgValue(args, '--config') ?? DEFAULT_CONFIG_PATH,
    port: getArgValue(args, '--port'),
    autoApprove: args.includes('--auto-approve'),
    logFormat,
    logFile: getArgValue(args, '--log-file'),
  });
}

try {
  await main();
} catch (err) {
  console.error('Fatal error:', err);
  process.exit(1);
}
