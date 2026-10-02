import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

export default function ProfileForm() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!/^[^@]+@[^@]+$/.test(email)) e.email = 'Enter a valid email';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = ev => {
    ev.preventDefault();
    if (!validate()) return;
    updateProfile({ name: name.trim(), email: email.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <Card>
      <h2>Profile</h2>
      <form onSubmit={onSubmit}>
        <label>
          Name
          <input value={name} onChange={e => setName(e.target.value)} />
          {errors.name && <span>{errors.name}</span>}
        </label>
        <label>
          Email
          <input value={email} onChange={e => setEmail(e.target.value)} />
          {errors.email && <span>{errors.email}</span>}
        </label>
        <Button type="submit">Save changes</Button>
        {saved && <p>Profile saved.</p>}
      </form>
    </Card>
  );
}
