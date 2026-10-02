import React, { useState } from 'react';
import { validatePassword } from '../utils/validators.js';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

export default function SecuritySettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [twofa, setTwofa] = useState(false);

  const submit = ev => {
    ev.preventDefault();
    const problems = validatePassword(next);
    if (!current) problems.push('Enter your current password');
    if (next !== confirm) problems.push("New passwords do not match");
    if (problems.length) {
      setError(problems.join(". "));
      setDone(false);
      return;
    }
    setError(null);
    setDone(true);
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  return (
    <div>
      <h2>Security</h2>
      <Card>
        <form onSubmit={submit}>
          <label>Current password
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} />
          </label>
          <label>New password
            <input type="password" value={next} onChange={e => setNext(e.target.value)} />
          </label>
          <label>Confirm new password
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </label>
          {error && <p role="alert">{error}</p>}
          {done && <p>Password updated.</p>}
          <Button type="submit">Change password</Button>
        </form>
      </Card>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <strong>Two-factor authentication</strong>
            <p>Add an extra sign-in step with an authenticator app.</p>
          </div>
          <Button variant="ghost" onClick={() => setTwofa(!twofa)}>
            {twofa ? "Disable" : "Enable"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
