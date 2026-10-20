import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import App from './App.jsx';

function renderApp(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe('application foundation', () => {
  it('renders the app in its main content area', () => {
    renderApp();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1 })).toBeVisible();
  });

  it('renders the home route', () => {
    renderApp('/');
    expect(screen.getByRole('heading', { name: 'Welcome to Construction Project Manager' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('heading', { name: 'Not Found' })).not.toBeInTheDocument();
  });

  it('renders Not Found for an unknown route and can navigate home', () => {
    renderApp('/unknown/page');
    expect(screen.getByRole('heading', { name: 'Not Found' })).toBeVisible();
    expect(screen.getByRole('banner')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Return home' }));
    expect(screen.getByRole('heading', { name: 'Welcome to Construction Project Manager' })).toBeVisible();
  });

  it('provides the shared header and navigation', () => {
    renderApp();
    expect(within(screen.getByRole('banner')).getByText('Construction Project Manager')).toBeVisible();
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
  });
});
