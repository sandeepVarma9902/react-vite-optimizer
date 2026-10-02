import React from 'react';
import Button from './Button.jsx';

export default function Tabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
      {tabs.map(t => (
        <Button
          key={t.id}
          variant={t.id === active ? "primary" : "ghost"}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}
