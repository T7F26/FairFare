import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AuthError } from '../api/auth.js'
import LoginForm from './LoginForm.jsx'

const admin = { id: '1', email: 'admin@example.com', role: 'admin' }
async function fillForm(user) {
  await user.type(screen.getByLabelText('Email'), admin.email)
  await user.type(screen.getByLabelText('Password'), ' pass word ')
}

it('uses browser validation for empty fields and malformed email without calling the API', async () => {
  const user = userEvent.setup()
  const login = vi.fn()
  render(<LoginForm login={login} onSuccess={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  expect(screen.getByLabelText('Email')).toBeInvalid()
  await user.type(screen.getByLabelText('Email'), 'bad-address')
  await user.type(screen.getByLabelText('Password'), 'password')
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  expect(screen.getByLabelText('Email')).toBeInvalid()
  expect(login).not.toHaveBeenCalled()
})

it('submits on Enter, preserves the password exactly, clears it and calls success', async () => {
  const user = userEvent.setup()
  const login = vi.fn().mockResolvedValue(admin)
  const onSuccess = vi.fn()
  render(<LoginForm login={login} onSuccess={onSuccess} />)
  await fillForm(user)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(admin))
  expect(login).toHaveBeenCalledWith({ email: admin.email, password: ' pass word ' })
  expect(screen.getByLabelText('Password')).toHaveValue('')
})

it('requires a password even when the email is valid', async () => {
  const user = userEvent.setup()
  const login = vi.fn()
  render(<LoginForm login={login} onSuccess={vi.fn()} />)
  await user.type(screen.getByLabelText('Email'), admin.email)
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  expect(screen.getByLabelText('Password')).toBeInvalid()
  expect(login).not.toHaveBeenCalled()
})

it('does not send credentials when the success callback has not been integrated', async () => {
  const user = userEvent.setup()
  const login = vi.fn()
  render(<LoginForm login={login} />)
  await fillForm(user)
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in is not available yet.')
  expect(login).not.toHaveBeenCalled()
})

it.each([{ ...admin, role: 'rider' }, null, {}])('never calls success for a non-admin or malformed result', async (result) => {
  const user = userEvent.setup()
  const onSuccess = vi.fn()
  render(<LoginForm login={vi.fn().mockResolvedValue(result)} onSuccess={onSuccess} />)
  await fillForm(user)
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(onSuccess).not.toHaveBeenCalled()
})

it('shows a safe message for unexpected failures', async () => {
  const user = userEvent.setup()
  render(<LoginForm login={vi.fn().mockRejectedValue(new Error('private server detail'))} onSuccess={vi.fn()} />)
  await fillForm(user)
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to sign in. Please try again.')
  expect(screen.getByRole('alert')).not.toHaveTextContent('private server detail')
})

it('disables pending submissions and sends only one request on a double click', async () => {
  const user = userEvent.setup()
  let finish
  const login = vi.fn(() => new Promise((resolve) => { finish = resolve }))
  const onSuccess = vi.fn()
  render(<LoginForm login={login} onSuccess={onSuccess} />)
  await fillForm(user)
  await user.dblClick(screen.getByRole('button', { name: 'Log in' }))
  expect(login).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
  expect(screen.getByLabelText('Email')).toBeDisabled()
  finish(admin)
  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(admin))
})

it.each([
  ['INVALID_CREDENTIALS', 'Email or password is incorrect.'],
  ['ADMIN_ACCESS_REQUIRED', 'This account does not have admin access'],
  ['ACCOUNT_LOCKED', 'Too many login attempts. Please try again in 15 minutes.'],
  ['NETWORK_ERROR', 'Unable to connect. Check your connection and try again.'],
])('shows %s and permits retry without navigating', async (code, message) => {
  const user = userEvent.setup()
  const login = vi.fn().mockRejectedValueOnce(new AuthError(code, message)).mockResolvedValue(admin)
  const onSuccess = vi.fn()
  render(<LoginForm login={login} onSuccess={onSuccess} />)
  await fillForm(user)
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(onSuccess).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Email')).toHaveValue(admin.email)
  expect(screen.getByLabelText('Password')).toHaveValue('')
  await user.type(screen.getByLabelText('Password'), 'correct password')
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
