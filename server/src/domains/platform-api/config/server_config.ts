export interface ServerConfig {
  appName: string
  environment: string
  port: number
}

function parsePort(value: string | undefined): number {
  const parsedPort = Number.parseInt(value ?? '3001', 10)

  if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
    return parsedPort
  }

  return 3001
}

export function getServerConfig(): ServerConfig {
  return {
    appName: 'lucifer',
    environment: process.env.NODE_ENV ?? 'development',
    port: parsePort(process.env.PORT),
  }
}
