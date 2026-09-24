// @vitest-environment node
import { describe, expect, it } from 'vitest'
import net from 'node:net'
import { createHttpServer, listenFailureMessage } from './create_http_server.js'

function errnoError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

describe('listenFailureMessage', () => {
  it('names the port and the settings that move it when the port is privileged', () => {
    const message = listenFailureMessage(errnoError('EACCES'), 443)
    expect(message).toMatch(/Cannot bind port 443: permission denied/)
    expect(message).toMatch(/--port, PORT or "port" in lucifer.json/)
  })

  it('names the port when another process already holds it', () => {
    expect(listenFailureMessage(errnoError('EADDRINUSE'), 3001)).toMatch(
      /Cannot bind port 3001: it is already in use/,
    )
  })

  it('keeps the original reason for any other bind failure', () => {
    expect(listenFailureMessage(errnoError('EADDRNOTAVAIL', 'address not available'), 3001)).toBe(
      'Cannot bind port 3001: address not available',
    )
  })

  it('describes the error a real listener emits on a port that is already taken', async () => {
    const holder = net.createServer()
    await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve))
    const { port } = holder.address() as net.AddressInfo

    try {
      const server = createHttpServer(() => undefined)
      const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
        server.once('error', resolve)
        server.listen(port, '127.0.0.1')
      })
      expect(listenFailureMessage(err, port)).toMatch(new RegExp(`port ${port}: it is already in use`))
    } finally {
      holder.close()
    }
  })
})
