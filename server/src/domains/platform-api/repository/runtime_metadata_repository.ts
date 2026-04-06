export interface RuntimeMetadataRepository {
  getCurrentTimestamp(): string
  getNodeVersion(): string
}

export function createRuntimeMetadataRepository(): RuntimeMetadataRepository {
  return {
    getCurrentTimestamp: () => new Date().toISOString(),
    getNodeVersion: () => process.version,
  }
}
