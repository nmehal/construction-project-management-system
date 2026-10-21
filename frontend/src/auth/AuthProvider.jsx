import { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as auth from '../api/auth.js';
import { onSessionCleared } from '../api/client.js';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const operation = useRef(0);

  useEffect(() => {
    let active = true;
    const current = operation.current;
    const unsubscribe = onSessionCleared(() => setUser(null));
    auth.restoreSession().then((restored) => {
      if (active && operation.current === current) setUser(restored);
    }).finally(() => {
      if (active && operation.current === current) setLoading(false);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  async function login(email, password) {
    const current = ++operation.current;
    setLoading(true);
    try {
      const loggedIn = await auth.login(email, password);
      if (operation.current === current) setUser(loggedIn);
      return loggedIn;
    } finally {
      if (operation.current === current) setLoading(false);
    }
  }
  async function logout() {
    ++operation.current;
    setUser(null);
    setLoading(true);
    try { await auth.logout(); }
    finally { setUser(null); setLoading(false); }
  }

  return (
    <AuthContext.Provider value={{ user, authenticated: Boolean(user), loading, login, logout, system_role: user?.system_role ?? null }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requires AuthProvider.');
  return context;
}
