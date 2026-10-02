import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Counter from './components/Counter';
import UserList from './components/UserList';
import LegacyCard from './components/LegacyCard';

const USERS = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
];

export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/users">Users</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Counter />} />
        <Route path="/users" element={<UserList users={USERS} title="Team" />} />
        <Route path="/legacy" element={<LegacyCard title="Old card" />} />
      </Routes>
    </BrowserRouter>
  );
}
