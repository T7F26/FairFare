export class AuthError extends Error {
  constructor(code, message, status = 0) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

export const ADMIN_ACCESS_MESSAGE = 'This account does not have admin access'
export const AUTH_UNAVAILABLE_MESSAGE = 'Sign-in is not available yet. Please try again later.'

export function requireAdmin(user) {
  if (!user || typeof user.role !== 'string' || !user.role.trim()) {
    throw new AuthError('INVALID_RESPONSE', 'Unable to verify your account. Please try again.')
  }
  if (user.role !== 'admin') {
    throw new AuthError('ADMIN_ACCESS_REQUIRED', ADMIN_ACCESS_MESSAGE, 403)
  }
  return user
}

// Configure only after the backend owner confirms the endpoint and response shape.
export function createLoginClient({ endpoint, readUser, fetchImpl = globalThis.fetch,
  credentials = 'same-origin', timeoutMs = 15000 } = {}) {
  return async function login({ email, password }) {
    if (!endpoint || typeof readUser !== 'function') {
      throw new AuthError('AUTH_NOT_CONFIGURED', AUTH_UNAVAILABLE_MESSAGE)
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
        credentials,
        signal: controller.signal,
      })
      // Do not expose arbitrary server text or a proxy's HTML to the user.
      if (!response.ok) {
        const errors = {
          401: ['INVALID_CREDENTIALS', 'Email or password is incorrect.'],
          403: ['ADMIN_ACCESS_REQUIRED', ADMIN_ACCESS_MESSAGE],
          429: ['ACCOUNT_LOCKED', 'Too many login attempts. Please try again in 15 minutes.'],
          404: ['AUTH_UNAVAILABLE', AUTH_UNAVAILABLE_MESSAGE],
          501: ['AUTH_UNAVAILABLE', AUTH_UNAVAILABLE_MESSAGE],
        }
        const [code, message] = errors[response.status] || ['SERVER_ERROR', 'Unable to sign in. Please try again.']
        throw new AuthError(code, message, response.status)
      }
      let user
      try {
        user = readUser(await response.json())
      } catch {
        throw new AuthError('INVALID_RESPONSE', 'Unable to verify your account. Please try again.')
      }
      return requireAdmin(user)
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError('NETWORK_ERROR', 'Unable to connect. Check your connection and try again.')
    } finally {
      clearTimeout(timeout)
    }
  }
}

// No endpoint is available in the repository yet; this rejects without a request.
export const loginAdmin = createLoginClient()
