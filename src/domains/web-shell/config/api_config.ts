const DEFAULT_API_BASE_URL = ''

export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL?.trim() ?? DEFAULT_API_BASE_URL
}
