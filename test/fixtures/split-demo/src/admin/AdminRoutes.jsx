import React from 'react';
import { Routes, Route } from 'react-router-dom';
import AdminDashboard from './AdminDashboard.jsx';
import UserTable from './UserTable.jsx';
import AdminPanel from './AdminPanel.jsx';
import SettingsPage from './SettingsPage.jsx';
import AuditLog from './AuditLog.jsx';

export default function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<AdminDashboard />} />
      <Route path="users" element={<UserTable />} />
      <Route path="panel" element={<AdminPanel />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="audit" element={<AuditLog />} />
    </Routes>
  );
}
