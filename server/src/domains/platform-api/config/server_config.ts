import path from 'node:path'

export interface ServerConfig {
  appName: string
  clientDistPath: string
  environment: string
  port: number
}

function parsePort(value: string | undefined): number {
  const parsedPort = Number.parseInt(value ?? '3001', 10)

  return Number.isFinite(parsedPort) ? parsedPort : 3001
}

export function getServerConfig(): ServerConfig {
  return {
    appName: 'lucifer',
    clientDistPath: path.resolve(process.cwd(), 'dist/client'),
    environment: process.env.NODE_ENV ?? 'development',
    port: parsePort(process.env.PORT),
  }
}
