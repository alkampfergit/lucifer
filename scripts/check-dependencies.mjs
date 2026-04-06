import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const domainRoots = [
  path.join(repoRoot, 'src', 'domains'),
  path.join(repoRoot, 'server', 'src', 'domains'),
]
const layerOrder = ['types', 'config', 'repository', 'service', 'runtime', 'ui', 'api']

// UI and API layers may only import from Types and Service (not Config, Repository, or Runtime).
const layerAllowList = {
  ui: new Set(['types', 'service']),
  api: new Set(['types', 'service']),
}
const importExpression = /from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g
const violations = []

function listFiles(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return []
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true })

  return entries.flatMap((entry) => {
    const entryPath = path.join(rootPath, entry.name)

    if (entry.isDirectory()) {
      return listFiles(entryPath)
    }

    return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : []
  })
}

function getDomainMetadata(filePath) {
  const parts = filePath.split(path.sep)
  const domainsIndex = parts.lastIndexOf('domains')

  if (domainsIndex === -1 || parts.length <= domainsIndex + 2) {
    return null
  }

  const domainName = parts[domainsIndex + 1]
  const layerName = parts[domainsIndex + 2]

  if (!layerOrder.includes(layerName)) {
    return null
  }

  return { domainName, layerName }
}

for (const filePath of domainRoots.flatMap(listFiles)) {
  const sourceMetadata = getDomainMetadata(filePath)

  if (sourceMetadata === null) {
    continue
  }

  const sourceLayerIndex = layerOrder.indexOf(sourceMetadata.layerName)
  const content = fs.readFileSync(filePath, 'utf8')

  for (const match of content.matchAll(importExpression)) {
    const specifier = match[1] ?? match[2]

    if (specifier === undefined || !specifier.startsWith('.')) {
      continue
    }

    const resolvedTarget = path.normalize(path.resolve(path.dirname(filePath), specifier))
    const targetMetadata = getDomainMetadata(resolvedTarget)

    if (targetMetadata === null) {
      continue
    }

    if (targetMetadata.domainName !== sourceMetadata.domainName) {
      violations.push(
        `${path.relative(repoRoot, filePath)} crosses into ${targetMetadata.domainName}; use shared contracts instead.`,
      )
      continue
    }

    const targetLayerIndex = layerOrder.indexOf(targetMetadata.layerName)

    // Same-layer imports are always allowed (e.g. test files importing the unit under test).
    if (targetMetadata.layerName === sourceMetadata.layerName) {
      continue
    }

    const allowList = layerAllowList[sourceMetadata.layerName]

    if (allowList !== undefined) {
      if (!allowList.has(targetMetadata.layerName)) {
        violations.push(
          `${path.relative(repoRoot, filePath)} (${sourceMetadata.layerName}) may only import from types or service, but imports ${targetMetadata.layerName} from ${specifier}.`,
        )
      }
    } else if (targetLayerIndex > sourceLayerIndex) {
      violations.push(
        `${path.relative(repoRoot, filePath)} cannot import ${targetMetadata.layerName} from ${specifier}.`,
      )
    }
  }
}

if (violations.length > 0) {
  console.error('DEPENDENCY VIOLATION(S):')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Dependency structure check passed.')
