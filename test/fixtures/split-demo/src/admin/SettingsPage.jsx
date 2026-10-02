import React, { useState } from 'react';
import Tabs from '../components/Tabs.jsx';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'payments', label: 'Payments' },
  { id: 'notifications', label: 'Notifications' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState("general");
  const [storeName, setStoreName] = useState("Split Demo Store");
  const [supportEmail, setSupportEmail] = useState("support@example.com");
  const [saved, setSaved] = useState(false);

  const save = ev => {
    ev.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="page">
      <h1>Settings</h1>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === "general" && (
        <Card>
          <form onSubmit={save}>
            <label>Store name
              <input value={storeName} onChange={e => setStoreName(e.target.value)} />
            </label>
            <label>Support email
              <input value={supportEmail} onChange={e => setSupportEmail(e.target.value)} />
            </label>
            <Button type="submit">Save settings</Button>
            {saved && <p>Settings saved.</p>}
          </form>
        </Card>
      )}
      {tab === "payments" && (
        <Card>
          <p>Payments are processed by the demo provider.</p>
          <p>Webhook URL: <code>https://example.com/hooks/payments</code></p>
        </Card>
      )}
      {tab === "notifications" && (
        <Card>
          <p>Admin alerts go to the support inbox.</p>
        </Card>
      )}
    </div>
  );
}
