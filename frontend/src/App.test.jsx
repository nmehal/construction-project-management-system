import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { clearSession, getAccessToken, request } from './api/client.js';

const user = { id: 'fictional-user', email: 'builder@example.com', system_role: 'Viewer' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
let network;
beforeEach(() => {
  clearSession();
  document.cookie = 'csrf_token=test-csrf; Path=/';
  network = vi.fn((path) => {
    if (path === '/auth/refresh') return Promise.resolve(reply({ access_token: 'restored-token' }));
    if (path === '/auth/me') return Promise.resolve(reply(user));
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  clearSession();
  document.cookie = 'csrf_token=; Max-Age=0; Path=/';
  vi.unstubAllGlobals();
});
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
function renderApp(path = '/') {
  return render(<StrictMode><MemoryRouter initialEntries={[path]}><App /><Location /></MemoryRouter></StrictMode>);
}
async function home() {
  return screen.findByRole('heading', { name: 'Welcome to Construction Project Manager' });
}
function expiredStartup() {
  network.mockImplementation((path) => {
    if (path === '/auth/refresh') return Promise.resolve(reply({ detail: 'Expired session' }, 401));
    throw new Error(`Unexpected request: ${path}`);
  });
}
async function fillLogin() {
  const button = await screen.findByRole('button', { name: 'Sign in' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-password' } });
  fireEvent.click(button);
}

describe('application shell and authentication', () => {
  it('renders the app in its main content area', async () => {
    renderApp();
    await home();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1 })).toBeVisible();
  });

  it('renders the protected home route after startup refresh', async () => {
    renderApp('/');
    expect(await home()).toBeVisible();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('heading', { name: 'Not Found' })).not.toBeInTheDocument();
    expect(network.mock.calls.map(([path]) => path)).toEqual(['/auth/refresh', '/auth/me']);
    expect(network.mock.calls[0][1].headers.get('X-CSRF-Token')).toBe('test-csrf');
    expect(network.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer restored-token');
  });

  it('renders Not Found for an unknown route and navigates home', async () => {
    renderApp('/unknown/page');
    expect(screen.getByRole('heading', { name: 'Not Found' })).toBeVisible();
    expect(screen.getByRole('banner')).toBeVisible();
    await screen.findByText(user.email);
    fireEvent.click(screen.getByRole('link', { name: 'Return home' }));
    expect(await home()).toBeVisible();
  });

  it('provides the header, user identity, navigation and skip link', async () => {
    renderApp();
    await home();
    expect(within(screen.getByRole('banner')).getByText('Construction Project Manager')).toBeVisible();
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByText(user.email)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
  });

  it('redirects unauthenticated protected access to login without protected navigation', async () => {
    expiredStartup();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('handles a startup network failure without crashing', async () => {
    network.mockRejectedValue(new TypeError('Offline'));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(getAccessToken()).toBeNull();
  });

  it('redirects an authenticated login-page visitor into the app', async () => {
    renderApp('/login');
    await home();
    expect(screen.getByTestId('location').textContent).toBe('/');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('logs in through the form, fetches me and displays authenticated identity', async () => {
    expiredStartup();
    renderApp('/login');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    network.mockImplementation((path) => Promise.resolve(path === '/auth/login' ? reply({ access_token: 'login-token' }) : reply(user)));
    await fillLogin();
    expect(await home()).toBeVisible();
    expect(screen.getByText(user.email)).toBeVisible();
    expect(getAccessToken()).toBe('login-token');
    const loginCall = network.mock.calls.find(([path]) => path === '/auth/login');
    expect(JSON.parse(loginCall[1].body)).toEqual({ email: user.email, password: 'fictional-password' });
  });

  it('displays backend login failure and remains unauthenticated', async () => {
    expiredStartup();
    renderApp('/login');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    network.mockResolvedValue(reply({ detail: 'Invalid credentials' }, 401));
    await fillLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });

  it.each([200, 503])('logout clears state and redirects even for server status %s', async (status) => {
    renderApp('/');
    await home();
    network.mockResolvedValue(reply(status === 200 ? { message: 'Logged out' } : { detail: 'Unavailable' }, status));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    expect(getAccessToken()).toBeNull();
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    const call = network.mock.calls.find(([path]) => path === '/auth/logout');
    expect(call[1].headers.get('X-CSRF-Token')).toBe('test-csrf');
    expect(call[1].credentials).toBe('include');
    if (status === 503) expect(screen.getByRole('alert')).toHaveTextContent('Server sign-out could not be confirmed');
  });

  it('clears provider identity when a protected request cannot refresh', async () => {
    renderApp('/');
    await home();
    network.mockResolvedValue(reply({ detail: 'Expired' }, 401));
    await expect(request('/projects')).rejects.toThrow('Expired');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  });
});
