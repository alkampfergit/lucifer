export function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx >= args.length - 1) return undefined;
  return args[idx + 1];
}

/**
 * Returns the first option the caller does not recognise, or `undefined` when
 * every option is known. Values that follow a value-taking flag are skipped, so
 * `--config --weird` reports nothing: `--weird` is the value of `--config`.
 *
 * Positional arguments are ignored here; the caller validates those.
 */
export function findUnknownOption(
  args: string[],
  known: { valueFlags: readonly string[]; booleanFlags: readonly string[] },
): string | undefined {
  const valueFlags = new Set(known.valueFlags);
  const booleanFlags = new Set(known.booleanFlags);

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (!arg.startsWith('-')) continue;
    if (booleanFlags.has(arg)) continue;

    if (valueFlags.has(arg)) {
      index++;
      continue;
    }

    return arg;
  }

  return undefined;
}
