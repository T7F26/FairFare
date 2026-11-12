import LoginForm from './components/LoginForm.jsx'

// Replace this minimal mount with the team's Admin Login page when #2 is ready.
export default function App({ login, onAuthenticated }) {
  return (
    <main className="admin-login">
      <h1>Admin Login</h1>
      <p>Sign in with an admin account to manage fare data.</p>
      <LoginForm login={login} onSuccess={onAuthenticated} />
    </main>
  )
}
