import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The package manifest sits three levels above this module in both layouts the
 * CLI runs from: `server/src/lib` in a checkout, and `dist/server/lib` in the
 * published package (`tsconfig.server.json` maps `server/src` onto
 * `dist/server`, so the depth is identical).
 *
 * The version is read from the manifest rather than baked into the source
 * because CI rewrites it with `npm version` just before publishing, so the
 * committed value is never the one an installed build should report.
 */
const PACKAGE_MANIFEST_PATH = path.resolve(import.meta.dirname, '../../../package.json');

function hasVersionString(value: unknown): value is { version: string } {
  if (typeof value !== 'object' || value === null || !('version' in value)) {
    return false;
  }

  const { version } = value as { version: unknown };
  return typeof version === 'string' && version.trim().length > 0;
}

/**
 * Reads the version of the installed package. Throws with the offending path
 * named rather than reporting a placeholder, because a version string that
 * cannot be trusted is worse than no answer when someone is checking which
 * build they are running.
 */
export function readPackageVersion(manifestPath: string = PACKAGE_MANIFEST_PATH): string {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read package manifest: ${manifestPath} (${reason})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in package manifest: ${manifestPath} (${reason})`);
  }

  if (!hasVersionString(parsed)) {
    throw new Error(`Package manifest has no version string: ${manifestPath}`);
  }

  return parsed.version;
}
