export function redactApiKeyName(name: string | null | undefined): string {
  if (!name) return '<none>';
  if (name.length <= 3) return '***';
  return `${name.slice(0, 2)}***${name.slice(-1)}`;
}
