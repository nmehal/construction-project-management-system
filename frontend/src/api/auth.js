import {
  request, setAccessToken, clearSession, refreshSession, csrfHeaders,
  getSessionGeneration, settleRefresh, ApiError,
} from './client.js';

let restoration = null;
export const getMe = () => request('/auth/me', { retry: false });

export async function login(email, password) {
  clearSession();
  const started = getSessionGeneration();
  await settleRefresh();
  try {
    const data = await request('/auth/login', {
      method: 'POST', json: { email, password }, authenticated: false,
    });
    if (started !== getSessionGeneration()) throw new ApiError('Session changed.', 401);
    setAccessToken(data?.access_token);
    return await getMe();
  } catch (error) {
    if (started === getSessionGeneration()) clearSession();
    throw error;
  }
}

export function restoreSession() {
  // Also coordinates React StrictMode's repeated mount effect.
  if (!restoration) {
    const started = getSessionGeneration();
    restoration = (async () => {
      try {
        await refreshSession();
        return await getMe();
      } catch {
        if (started === getSessionGeneration()) clearSession();
        return null;
      } finally {
        restoration = null;
      }
    })();
  }
  return restoration;
}

export async function logout() {
  clearSession();
  await settleRefresh();
  return request('/auth/logout', {
    method: 'POST', authenticated: false, headers: csrfHeaders(),
  });
}
