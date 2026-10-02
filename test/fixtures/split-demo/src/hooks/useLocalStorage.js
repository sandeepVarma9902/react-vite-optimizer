import { useCallback, useState } from 'react';

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => read(key, initial));

  const set = useCallback(
    next => {
      setValue(prev => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // storage full or unavailable — keep in memory
        }
        return resolved;
      });
    },
    [key]
  );

  return [value, set];
}
