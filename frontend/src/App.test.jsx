import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createLoginClient } from './api/auth.js'
import App from './App.jsx'

it('mounts the form and reports unavailable integration without navigating', async () => {
  const user = userEvent.setup()
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Admin Login' })).toBeInTheDocument()
  await user.type(screen.getByLabelText('Email'), 'admin@example.com')
  await user.type(screen.getByLabelText('Password'), 'test password')
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in is not available yet.')
  expect(screen.getByLabelText('Password')).toHaveValue('')
})

it('connects a configured request to the navigation callback supplied by the page owner', async () => {
  const user = userEvent.setup()
  const admin = { role: 'admin', email: 'admin@example.com' }
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: admin }) })
  const login = createLoginClient({ endpoint: '/test-login-endpoint', readUser: (data) => data.account, fetchImpl })
  const navigate = vi.fn()
  // The actual Import Data route has not been published; this is only a test target.
  render(<App login={login} onAuthenticated={() => navigate('/test-import-page')} />)
  await user.type(screen.getByLabelText('Email'), admin.email)
  await user.type(screen.getByLabelText('Password'), 'test password')
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/test-import-page'))
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
