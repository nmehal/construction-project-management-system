import { NavLink, Outlet } from 'react-router';

export default function AppLayout() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <div className="header-inner">
          <span className="app-name">Construction Project Manager</span>
          <nav aria-label="Main navigation">
            <NavLink to="/" end>Home</NavLink>
          </nav>
        </div>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
