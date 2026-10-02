import React from 'react';
import { Link } from 'react-router-dom';
import { useAdminStats } from './useAdminStats.js';
import Card from '../components/Card.jsx';
import Spinner from '../components/Spinner.jsx';

export default function AdminDashboard() {
  const { stats, loading } = useAdminStats();

  return (
    <div className="page">
      <h1>Admin dashboard</h1>
      {loading && <Spinner label="Loading stats" />}
      {!loading && stats && (
        <div className="grid">
          <Card><h3>Revenue</h3><p>${stats.revenue}</p></Card>
          <Card><h3>Orders</h3><p>{stats.orders}</p></Card>
          <Card><h3>Users</h3><p>{stats.users}</p></Card>
          <Card><h3>Refunds</h3><p>{stats.refunds}</p></Card>
        </div>
      )}
      <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
        <Link to="/admin/users">Manage users</Link>
        <Link to="/admin/panel">Ops panel</Link>
      </div>
    </div>
  );
}
