import { join } from 'node:path';

/**
 * tsx's JS entrypoint, to be spawned through `process.execPath` rather than
 * through the `node_modules/.bin/tsx` shim.
 *
 * The shim is an extensionless shell script; on Windows the executable of
 * that name is `tsx.cmd`, so spawning the extensionless path fails with
 * ENOENT. Addressing the entrypoint directly avoids both the platform-
 * specific shim name and the need for `shell: true` to run a `.cmd`.
 *
 * Shared rather than declared per test file so the two callers cannot drift
 * apart and reintroduce the shim path on one of them.
 */
export const TSX_ENTRY = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
