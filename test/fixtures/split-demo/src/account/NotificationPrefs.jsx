import React from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage.js';
import Card from '../components/Card.jsx';

const CHANNELS = [
  { id: 'order-updates', label: 'Order updates', blurb: 'Shipping and delivery status.' },
  { id: 'price-drops', label: 'Price drops', blurb: 'When wishlist items go on sale.' },
  { id: 'newsletter', label: 'Newsletter', blurb: 'Monthly store news.' },
];

export default function NotificationPrefs() {
  const [prefs, setPrefs] = useLocalStorage("notify-prefs", {
    'order-updates': true,
    'price-drops': false,
    newsletter: false,
  });

  const toggle = id => setPrefs({ ...prefs, [id]: !prefs[id] });

  return (
    <div>
      <h2>Notifications</h2>
      {CHANNELS.map(c => (
        <Card key={c.id}>
          <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={!!prefs[c.id]}
              onChange={() => toggle(c.id)}
            />
            <span>
              <strong>{c.label}</strong>
              <br />
              <span>{c.blurb}</span>
            </span>
          </label>
        </Card>
      ))}
    </div>
  );
}
