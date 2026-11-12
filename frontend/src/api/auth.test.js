import { describe, expect, it, vi } from 'vitest'
import { ADMIN_ACCESS_MESSAGE, createLoginClient, loginAdmin } from './auth.js'

const admin = { id: 'admin-1', email: 'admin@example.com', role: 'admin' }
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data })
// This payload is a test fixture, not a proposed backend response contract.
const configuredClient = (fetchImpl, options = {}) => createLoginClient({
  endpoint: '/test-login-endpoint', readUser: (data) => data.account, fetchImpl, ...options,
})

describe('login request handling', () => {
  it('does not send a request until the endpoint and response adapter are configured', async () => {
    const fetchImpl = vi.fn()
    await expect(createLoginClient({ fetchImpl })({ email: admin.email, password: 'test' }))
      .rejects.toMatchObject({ code: 'AUTH_NOT_CONFIGURED' })
    await expect(createLoginClient({ endpoint: '/test-login-endpoint', fetchImpl })({ email: admin.email, password: 'test' }))
      .rejects.toMatchObject({ code: 'AUTH_NOT_CONFIGURED' })
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(loginAdmin({ email: admin.email, password: 'test' })).rejects.toMatchObject({ code: 'AUTH_NOT_CONFIGURED' })
  })

  it('posts trimmed email and unchanged password to the configured endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { account: admin }))
    await expect(configuredClient(fetchImpl)({ email: ' admin@example.com ', password: ' pass word ' })).resolves.toEqual(admin)
    expect(fetchImpl).toHaveBeenCalledWith('/test-login-endpoint', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: ' pass word ' }),
    }))
  })

  it('allows a cookie transport option when the backend owner explicitly configures it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { account: admin }))
    await configuredClient(fetchImpl, { credentials: 'include' })({ email: admin.email, password: 'test' })
    expect(fetchImpl).toHaveBeenCalledWith('/test-login-endpoint', expect.objectContaining({ credentials: 'include' }))
  })

  it.each([[401, 'INVALID_CREDENTIALS'], [403, 'ADMIN_ACCESS_REQUIRED'], [429, 'ACCOUNT_LOCKED'],
    [404, 'AUTH_UNAVAILABLE'], [501, 'AUTH_UNAVAILABLE'], [500, 'SERVER_ERROR']])('handles HTTP %s without exposing server text', async (status, code) => {
    const client = configuredClient(vi.fn().mockResolvedValue(response(status, { message: 'private server detail' })))
    await expect(client({ email: admin.email, password: 'test' })).rejects.toMatchObject({ code, status })
  })

  it('rejects a rider even when the server returns HTTP 200', async () => {
    const client = configuredClient(vi.fn().mockResolvedValue(response(200, { account: { ...admin, role: 'rider' } })))
    await expect(client({ email: admin.email, password: 'test' })).rejects.toMatchObject({ message: ADMIN_ACCESS_MESSAGE })
  })

  it.each([{}, { account: {} }, { account: { role: '' } }])('rejects incomplete success data', async (data) => {
    const client = configuredClient(vi.fn().mockResolvedValue(response(200, data)))
    await expect(client({ email: admin.email, password: 'test' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('handles HTML instead of JSON without exposing its contents', async () => {
    const client = configuredClient(vi.fn().mockResolvedValue({ ok: true, json: () => { throw new SyntaxError() } }))
    await expect(client({ email: admin.email, password: 'test' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('handles network failure', async () => {
    const client = configuredClient(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(client({ email: admin.email, password: 'test' })).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('aborts stalled requests so the form can be retried', async () => {
    const client = configuredClient((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }), { timeoutMs: 5 })
    await expect(client({ email: admin.email, password: 'test' })).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})
