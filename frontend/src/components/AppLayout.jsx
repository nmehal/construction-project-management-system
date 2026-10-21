import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.jsx';

export default function AppLayout() {
  const { user, authenticated, loading, logout } = useAuth();
  const [logoutError, setLogoutError] = useState('');
  const navigate = useNavigate();
  async function signOut() {
    setLogoutError('');
    try { await logout(); }
    catch { setLogoutError('Signed out locally. Server sign-out could not be confirmed; your browser session may still be active.'); }
    finally { navigate('/login', { replace: true }); }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <div className="header-inner">
          <span className="app-name">Construction Project Manager</span>
          {authenticated && (
            <nav aria-label="Main navigation">
              <NavLink to="/" end>Home</NavLink>
              <span className="user-identity">{user.email}</span>
              <button type="button" onClick={signOut} disabled={loading}>Sign out</button>
            </nav>
          )}
        </div>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {logoutError && <p role="alert" className="form-error">{logoutError}</p>}
        <Outlet />
      </main>
    </div>
  );
}
