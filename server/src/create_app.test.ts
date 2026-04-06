// @vitest-environment node
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './create_app.js'

describe('createApp', () => {
  it('serves the health endpoint', async () => {
    const { app } = createApp()

    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body.name).toBe('lucifer')
    expect(response.body.status).toBe('ok')
  })
})
