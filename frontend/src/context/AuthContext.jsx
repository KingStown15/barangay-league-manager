import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import {
  getToken,
  setToken,
  setStoredUser,
  SESSION_EXPIRED_EVENT,
} from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let current = true;

    function clearExpiredSession() {
      if (!current) return;
      setUser(null);
      setLoading(false);
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, clearExpiredSession);

    async function restoreSession() {
      if (!getToken()) {
        setStoredUser(null);
        if (current) setLoading(false);
        return;
      }
      try {
        const data = await api.get('/auth/me');
        if (!current) return;
        setStoredUser(data.user);
        setUser(data.user);
      } catch {
        if (!current) return;
        setToken(null);
        setStoredUser(null);
        setUser(null);
      } finally {
        if (current) setLoading(false);
      }
    }

    restoreSession();
    return () => {
      current = false;
      window.removeEventListener(SESSION_EXPIRED_EVENT, clearExpiredSession);
    };
  }, []);

  const login = useCallback(async (username, password) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post('/auth/login', { username, password }, { auth: false });
      setToken(data.token);
      setStoredUser(data.user);
      setUser(data.user);
      return data.user;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setStoredUser(null);
    setUser(null);
    setError(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
