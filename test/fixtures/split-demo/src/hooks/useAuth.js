import { useCallback, useState } from 'react';

const DEMO_USER = { name: "Jordan Lee", email: "jordan@example.com" };

export function useAuth() {
  const [user, setUser] = useState(DEMO_USER);

  const logout = useCallback(() => {
    setUser(null);
  }, []);

  const updateProfile = useCallback(patch => {
    setUser(prev => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const login = useCallback(next => {
    setUser(next);
  }, []);

  return { user: user || DEMO_USER, logout, updateProfile, login };
}
