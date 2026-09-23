import { readPackageVersion } from '../lib/package_version.js';

/**
 * Prints the bare version on stdout, matching `node --version` and
 * `npm --version` so the output can be captured by a script without parsing.
 */
export function printVersion() {
  console.log(readPackageVersion());
}
