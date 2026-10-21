import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, setAccessToken, getAccessToken, clearSession, readCsrfCookie, refreshSession, settleRefresh } from './client.js';
import { login, logout, restoreSession } from './auth.js';

const user = { id: 'fictional-user', email: 'builder@example.com', system_role: 'Viewer' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
let network;
beforeEach(() => {
  clearSession();
  document.cookie = 'csrf_token=csrf-value; Path=/';
  network = vi.fn();
  vi.stubGlobal('fetch', network);
});
afterEach(async () => {
  await settleRefresh();
  clearSession();
  document.cookie = 'csrf_token=; Max-Age=0; Path=/';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('same-origin API transport and sessions', () => {
  it('sends memory-only bearer credentials and JSON', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    setAccessToken('access-one');
    network.mockResolvedValueOnce(reply({ updated: true }));
    expect(await request('/projects/example', { method: 'PATCH', json: { name: 'Fictional' } })).toEqual({ updated: true });
    const [path, options] = network.mock.calls[0];
    expect(path).toBe('/projects/example');
    expect(options.credentials).toBe('include');
    expect(options.headers.get('Authorization')).toBe('Bearer access-one');
    expect(options.headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({ name: 'Fictional' });
    expect(storage).not.toHaveBeenCalled();
  });

  it.each(['https://example.com/data', '//example.com/data', '/\\example.com', ' /auth/me'])('rejects unsafe URL %s before sending credentials', async (path) => {
    await expect(request(path)).rejects.toThrow('same-origin relative');
    expect(network).not.toHaveBeenCalled();
  });

  it('reads only the exact CSRF cookie and safely handles bad encoding', () => {
    document.cookie = 'not_csrf_token=wrong; Path=/';
    document.cookie = 'csrf_token=encoded%3Dvalue; Path=/';
    expect(readCsrfCookie()).toBe('encoded=value');
    document.cookie = 'csrf_token=%E0%A4%A; Path=/';
    expect(readCsrfCookie()).toBeNull();
    document.cookie = 'not_csrf_token=; Max-Age=0; Path=/';
  });

  it('logs in, then fetches /auth/me with the returned token', async () => {
    network.mockResolvedValueOnce(reply({ access_token: 'login-token' }))
      .mockResolvedValueOnce(reply(user));
    expect(await login(user.email, 'fictional-password')).toEqual(user);
    expect(network.mock.calls[0][0]).toBe('/auth/login');
    expect(JSON.parse(network.mock.calls[0][1].body)).toEqual({ email: user.email, password: 'fictional-password' });
    expect(network.mock.calls[1][0]).toBe('/auth/me');
    expect(network.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer login-token');
  });

  it('does not refresh failed login credentials', async () => {
    network.mockResolvedValueOnce(reply({ detail: 'Invalid credentials' }, 401));
    await expect(login(user.email, 'wrong')).rejects.toThrow('Invalid credentials');
    expect(network).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('refreshes and retries a protected 401 once with the new bearer', async () => {
    setAccessToken('expired');
    network.mockResolvedValueOnce(reply({ detail: 'Expired' }, 401))
      .mockResolvedValueOnce(reply({ access_token: 'fresh' }))
      .mockResolvedValueOnce(reply({ id: 'project' }));
    expect(await request('/projects/project')).toEqual({ id: 'project' });
    expect(network.mock.calls.map(([path]) => path)).toEqual(['/projects/project', '/auth/refresh', '/projects/project']);
    expect(network.mock.calls[1][1].headers.get('X-CSRF-Token')).toBe('csrf-value');
    expect(network.mock.calls[1][1].headers.has('Authorization')).toBe(false);
    expect(network.mock.calls[2][1].headers.get('Authorization')).toBe('Bearer fresh');
  });

  it('stops after the retried request returns 401', async () => {
    setAccessToken('expired');
    network.mockResolvedValueOnce(reply({}, 401))
      .mockResolvedValueOnce(reply({ access_token: 'fresh' }))
      .mockResolvedValueOnce(reply({ detail: 'Still denied' }, 401));
    await expect(request('/projects')).rejects.toThrow('Still denied');
    expect(network).toHaveBeenCalledTimes(3);
    expect(getAccessToken()).toBeNull();
  });

  it('does not retry the resource when refresh fails', async () => {
    setAccessToken('expired');
    network.mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply({ detail: 'Refresh expired' }, 401));
    await expect(request('/projects')).rejects.toThrow('Refresh expired');
    expect(network).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBeNull();
  });

  it('coordinates simultaneous 401s into one refresh', async () => {
    setAccessToken('old');
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    network.mockImplementation((path, options) => {
      if (path === '/auth/refresh') return pending;
      return Promise.resolve(options.headers.get('Authorization') === 'Bearer old' ? reply({}, 401) : reply({ path }));
    });
    const first = request('/projects/one');
    const second = request('/projects/two');
    await vi.waitFor(() => expect(network.mock.calls.filter(([path]) => path === '/auth/refresh')).toHaveLength(1));
    release(reply({ access_token: 'new' }));
    expect(await Promise.all([first, second])).toEqual([{ path: '/projects/one' }, { path: '/projects/two' }]);
    expect(network.mock.calls.filter(([path]) => path === '/auth/refresh')).toHaveLength(1);
  });

  it('does not refresh forbidden requests', async () => {
    setAccessToken('valid');
    network.mockResolvedValueOnce(reply({ detail: 'Access denied' }, 403));
    await expect(request('/projects')).rejects.toMatchObject({ status: 403, message: 'Access denied' });
    expect(network).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('valid');
  });

  it('safely handles validation arrays and non-JSON errors', async () => {
    network.mockResolvedValueOnce(reply({ detail: [{ msg: 'Field required' }] }, 422));
    await expect(request('/projects')).rejects.toThrow('Field required');
    network.mockResolvedValueOnce(new Response('<html>upstream error</html>', { status: 502 }));
    await expect(request('/projects')).rejects.toThrow('Request failed (502).');
  });

  it('restores a session through refresh and me, coordinated across callers', async () => {
    network.mockResolvedValueOnce(reply({ access_token: 'restored' })).mockResolvedValueOnce(reply(user));
    expect(await Promise.all([restoreSession(), restoreSession()])).toEqual([user, user]);
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls[0][1].headers.get('X-CSRF-Token')).toBe('csrf-value');
    expect(getAccessToken()).toBe('restored');
  });

  it('clears tokens if startup /me fails', async () => {
    network.mockResolvedValueOnce(reply({ access_token: 'restored' })).mockRejectedValueOnce(new TypeError('Network unavailable'));
    expect(await restoreSession()).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('sends CSRF on logout and clears tokens even on server failure', async () => {
    setAccessToken('current');
    network.mockResolvedValueOnce(reply({ detail: 'Unavailable' }, 503));
    await expect(logout()).rejects.toThrow('Unavailable');
    expect(getAccessToken()).toBeNull();
    expect(network.mock.calls[0][0]).toBe('/auth/logout');
    expect(network.mock.calls[0][1].headers.get('X-CSRF-Token')).toBe('csrf-value');
    expect(network.mock.calls[0][1].credentials).toBe('include');
  });

  it('cannot resurrect a token from a refresh completing during logout', async () => {
    let release;
    network.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce(reply({ message: 'Logged out' }));
    const refresh = refreshSession().catch((error) => error);
    const signedOut = logout();
    release(reply({ access_token: 'late-token' }));
    expect((await refresh).message).toBe('Session changed.');
    await signedOut;
    expect(getAccessToken()).toBeNull();
    expect(network.mock.calls.map(([path]) => path)).toEqual(['/auth/refresh', '/auth/logout']);
  });
});
