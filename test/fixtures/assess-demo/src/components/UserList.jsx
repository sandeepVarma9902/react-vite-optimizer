import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import styles from './UserList.module.css';
import UserCard from './UserCard';

function fetchUsers() {
  return axios.get('/api/users').then(r => r.data);
}

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: fetchUsers });
}

export default function UserList() {
  const [filter, setFilter] = useState('');
  const { data, isLoading } = useUsers();

  useEffect(() => {
    document.title = 'Users';
  }, []);

  if (isLoading) return <div className={styles.loading}>Loading…</div>;

  const shown = (data || []).filter(u => u.name.includes(filter));

  return (
    <div className={styles.list}>
      <input
        className={styles.search}
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Filter users"
      />
      {shown.map(u => (
        <UserCard key={u.id} user={u} />
      ))}
    </div>
  );
}
