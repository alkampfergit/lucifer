// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PORT, getServerConfig, resolveListenerPort } from './server_config.js'

const originalPort = process.env.PORT

afterEach(() => {
  if (originalPort === undefined) {
    delete process.env.PORT
  } else {
    process.env.PORT = originalPort
  }
})

describe('resolveListenerPort', () => {
  it('prefers PORT, which is what the CLI --port flag sets', () => {
    process.env.PORT = '4100'
    expect(resolveListenerPort(4000)).toBe(4100)
  })

  it('falls back to the port from lucifer.json when PORT is unset', () => {
    delete process.env.PORT
    expect(resolveListenerPort(4000)).toBe(4000)
  })

  it('falls back to the built-in default when neither names a port', () => {
    delete process.env.PORT
    expect(resolveListenerPort()).toBe(DEFAULT_PORT)
  })

  it.each(['0', '70000', 'not-a-port', ''])(
    'ignores an unusable PORT value (%s) rather than dropping the configured port',
    (value) => {
      process.env.PORT = value
      expect(resolveListenerPort(4000)).toBe(4000)
    },
  )

  it('reports the same port through getServerConfig', () => {
    process.env.PORT = '4200'
    expect(getServerConfig().port).toBe(4200)
  })
})
