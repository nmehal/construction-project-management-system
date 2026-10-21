// Tokens live only in this module; refresh cookies remain browser-managed.
let accessToken = null;
let generation = 0;
let refreshPromise = null;
const listeners = new Set();

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export const getAccessToken = () => accessToken;
export const getSessionGeneration = () => generation;
export function setAccessToken(token) {
  if (typeof token !== 'string' || !token.trim()) throw new ApiError('Invalid authentication response.');
  accessToken = token;
}
export function clearSession() {
  generation += 1;
  accessToken = null;
  listeners.forEach((listener) => listener());
}
export function onSessionCleared(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readCsrfCookie() {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('csrf_token='));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice('csrf_token='.length)) || null; }
  catch { return null; }
}
export function csrfHeaders() {
  const csrf = readCsrfCookie();
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

function errorMessage(data, status) {
  if (typeof data?.detail === 'string') return data.detail;
  if (Array.isArray(data?.detail)) {
    const messages = data.detail.map((item) => typeof item?.msg === 'string' ? item.msg : '').filter(Boolean);
    if (messages.length) return messages.join('; ');
  }
  return `Request failed (${status}).`;
}

export async function request(path, options = {}) {
  // Prevent bearer/cookie leakage to absolute or protocol-relative destinations.
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\s]/.test(path)) {
    throw new ApiError('API requests must use same-origin relative paths.');
  }
  const { method = 'GET', json, headers: suppliedHeaders, authenticated = true, retry = true, signal } = options;
  const started = generation;
  const usedToken = accessToken;
  const headers = new Headers(suppliedHeaders);
  headers.set('Accept', 'application/json');
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  if (authenticated && usedToken) headers.set('Authorization', `Bearer ${usedToken}`);
  const response = await fetch(path, {
    method, headers, credentials: 'include', signal,
    body: json === undefined ? undefined : JSON.stringify(json),
    redirect: 'error',
  });
  if (authenticated && started !== generation) throw new ApiError('Session changed.', 401);
  if (response.status === 401 && authenticated) {
    if (retry) {
      // Reuse a token refreshed by another request, even if its refresh finished.
      if (!accessToken || accessToken === usedToken) await refreshSession();
      if (started !== generation) throw new ApiError('Session changed.', 401);
      return request(path, { ...options, retry: false });
    }
    clearSession();
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch {
    if (response.ok) throw new ApiError('Invalid JSON response.', response.status);
  }
  if (!response.ok) throw new ApiError(errorMessage(data, response.status), response.status, data);
  return data;
}

export function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const started = generation;
  refreshPromise = (async () => {
    try {
      const data = await request('/auth/refresh', {
        method: 'POST', authenticated: false, headers: csrfHeaders(),
      });
      if (started !== generation) throw new ApiError('Session changed.', 401);
      setAccessToken(data?.access_token);
      return accessToken;
    } catch (error) {
      if (started === generation) clearSession();
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function settleRefresh() {
  // Wait for a rotating cookie before logging out or starting another login.
  try { await refreshPromise; } catch { /* caller has already invalidated the session */ }
}
