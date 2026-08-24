import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAccessToken, getAccessToken, setSessionLostHandler, errorMessage } from '../api/client.js';

const AuthContext = createContext(null);

const CAPABILITIES = {
  admin: ['manageUsers', 'manageProjects', 'runScans', 'triageFindings', 'viewAudit', 'editSettings'],
  security_analyst: ['manageProjects', 'runScans', 'triageFindings', 'viewAudit'],
  developer: ['runScans'],
  viewer: [],
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    setSessionLostHandler(() => {
      setUser(null);
      setSessionExpired(true);
    });
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      if (!getAccessToken()) {
        setLoading(false);
        return;
      }
      try {
        const { user: current } = await api.me();
        setUser(current);
      } catch {
        setAccessToken(null);
      } finally {
        setLoading(false);
      }
    };
    void bootstrap();
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await api.login(credentials);
    // The API answers with a challenge instead of a session when MFA is due.
    if (data.mfaRequired) return { mfaRequired: true };
    if (data.mfaEnrollmentRequired) return { mfaEnrollmentRequired: true };
    setAccessToken(data.accessToken);
    setUser(data.user);
    setSessionExpired(false);
    return { user: data.user };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // A failed logout call must still clear local state.
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const { user: current } = await api.me();
    setUser(current);
    return current;
  }, []);

  const can = useCallback((capability) => CAPABILITIES[user?.role]?.includes(capability) ?? false, [user]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser, can, sessionExpired, setSessionExpired, errorMessage }),
    [user, loading, login, logout, refreshUser, can, sessionExpired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
};

export default AuthContext;
