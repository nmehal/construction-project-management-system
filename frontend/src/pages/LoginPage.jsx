import { useState } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';

export default function LoginPage() {
  const { authenticated, loading, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  if (authenticated) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    if (submitting || loading) return;
    setError('');
    setSubmitting(true);
    try { await login(email.trim(), password); }
    catch (failure) { setError(failure.message || 'Unable to sign in. Please try again.'); }
    finally { setPassword(''); setSubmitting(false); }
  }

  return (
    <section className="page-panel login-panel" aria-labelledby="login-title">
      <h1 id="login-title">Sign in</h1>
      <p>Sign in to your construction workspace.</p>
      {loading && !submitting && <p role="status">Restoring session…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <form onSubmit={submit} aria-busy={submitting}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading || submitting} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading || submitting} />
        <button type="submit" disabled={loading || submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  );
}
