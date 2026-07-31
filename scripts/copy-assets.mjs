import fs from 'node:fs'
import path from 'node:path'

// `tsc` emits only .js for .ts inputs, so any non-TypeScript file the server
// reads at runtime has to be mirrored into the build output separately. Without
// this step the published package ships code that cannot find its own assets.
const assetExtensions = new Set(['.html'])

function readArg(name, fallback) {
  const prefix = `--${name}=`
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix))

  return match === undefined ? fallback : match.slice(prefix.length)
}

const repoRoot = process.cwd()
const sourceRoot = path.resolve(repoRoot, readArg('src', path.join('server', 'src')))
const outputRoot = path.resolve(repoRoot, readArg('out', path.join('dist', 'server')))

function listAssets(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return []
  }

  return fs.readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(rootPath, entry.name)

    if (entry.isDirectory()) {
      return listAssets(entryPath)
    }

    return assetExtensions.has(path.extname(entry.name)) ? [entryPath] : []
  })
}

const assets = listAssets(sourceRoot)

// Zero assets means the extension list drifted away from what the tree holds.
// Treat it as a build failure rather than silently publishing without them.
if (assets.length === 0) {
  console.error(`ASSET COPY FAILED: no runtime assets found under ${path.relative(repoRoot, sourceRoot)}.`)
  process.exit(1)
}

for (const assetPath of assets) {
  const targetPath = path.join(outputRoot, path.relative(sourceRoot, assetPath))

  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(assetPath, targetPath)
}

console.log(`Copied ${assets.length} runtime asset(s) into ${path.relative(repoRoot, outputRoot)}.`)
