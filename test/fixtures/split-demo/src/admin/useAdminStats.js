import { useEffect, useState } from 'react';
import { fetchAdminStats } from './adminApi.js';

export function useAdminStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchAdminStats().then(s => {
      if (!cancelled) {
        setStats(s);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { stats, loading };
}
