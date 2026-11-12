import { useRef, useState } from 'react'
import { AUTH_UNAVAILABLE_MESSAGE, AuthError, loginAdmin, requireAdmin } from '../api/auth.js'
import './LoginForm.css'

export default function LoginForm({ login = loginAdmin, onSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setSubmitting(true)
    setError('')
    try {
      if (typeof onSuccess !== 'function') {
        throw new AuthError('AUTH_NOT_CONFIGURED', AUTH_UNAVAILABLE_MESSAGE)
      }
      const user = requireAdmin(await login({ email: email.trim(), password }))
      setPassword('')
      await onSuccess(user)
    } catch (failure) {
      setError(failure instanceof AuthError ? failure.message : 'Unable to sign in. Please try again.')
      setPassword('')
    } finally {
      pending.current = false
      setSubmitting(false)
    }
  }

  return (
    <form className="admin-login-form" onSubmit={handleSubmit} aria-label="Admin login" aria-busy={submitting}>
      <label htmlFor="login-email">Email</label>
      <input id="login-email" name="email" type="email" autoComplete="username" required
        value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting}
        aria-describedby={error ? 'login-error' : undefined} />
      <label htmlFor="login-password">Password</label>
      <input id="login-password" name="password" type="password" autoComplete="current-password" required
        value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting}
        aria-describedby={error ? 'login-error' : undefined} />
      {error && <p id="login-error" role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Log in'}</button>
    </form>
  )
}
