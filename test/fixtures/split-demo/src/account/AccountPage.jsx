import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import Card from '../components/Card.jsx';

export default function AccountPage() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="page">
      <h1>My account</h1>
      <Card>
        <p>Signed in as <strong>{user.name}</strong> ({user.email})</p>
        <button onClick={logout}>Sign out</button>
      </Card>
      <nav style={{ display: "flex", gap: "1rem", margin: "1rem 0" }}>
        <Link to="/account">Profile</Link>
        <Link to="/account/orders">Orders</Link>
        <Link to="/account/addresses">Addresses</Link>
        <Link to="/account/security">Security</Link>
        <Link to="/account/notifications">Notifications</Link>
      </nav>
      <p className="dim">Current: {location.pathname}</p>
      <Outlet />
    </div>
  );
}
