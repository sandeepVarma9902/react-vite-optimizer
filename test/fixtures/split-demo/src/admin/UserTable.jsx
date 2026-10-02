import React, { useEffect, useState } from 'react';
import { fetchUsers, updateUserRole } from './adminApi.js';
// NOTE: reaching into the shop feature for cart internals — this is the
// kind of coupling rvo split flags before a microfrontend extraction.
import { useCart } from '../shop/useCart.js';
import Card from '../components/Card.jsx';
import DataTable from '../components/DataTable.jsx';
import Button from '../components/Button.jsx';
import Spinner from '../components/Spinner.jsx';

export default function UserTable() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { count: activeCarts } = useCart();

  useEffect(() => {
    fetchUsers().then(list => {
      setUsers(list);
      setLoading(false);
    });
  }, []);

  const promote = async id => {
    await updateUserRole(id, "support");
    setUsers(users.map(u => (u.id === id ? { ...u, role: "support" } : u)));
  };

  return (
    <div className="page">
      <h1>Users</h1>
      <p>Active carts right now (from the shop store): {activeCarts}</p>
      {loading && <Spinner label="Loading users" />}
      {!loading && (
        <Card>
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>
                    {u.role === "customer" && (
                      <Button variant="ghost" onClick={() => promote(u.id)}>
                        Make support
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
