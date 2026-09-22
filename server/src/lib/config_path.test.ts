// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG_PATH, resolveDefaultConfigPath } from './config_path.js'

const originalCwd = process.cwd()
const dirs: string[] = []

function useEmptyCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lucifer-config-path-'))
  dirs.push(dir)
  process.chdir(dir)
  return dir
}

afterEach(() => {
  process.chdir(originalCwd)
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  dirs.length = 0
})

describe('resolveDefaultConfigPath', () => {
  it('finds the config the CLI would have loaded, so a tls block is not ignored', () => {
    const dir = useEmptyCwd()
    mkdirSync(join(dir, 'config'), { recursive: true })
    writeFileSync(join(dir, 'config', 'lucifer.json'), '{}')

    expect(resolveDefaultConfigPath()).toBe(DEFAULT_CONFIG_PATH)
  })

  it('returns undefined when there is no config directory, keeping built-in defaults', () => {
    useEmptyCwd()

    expect(resolveDefaultConfigPath()).toBeUndefined()
  })
})
