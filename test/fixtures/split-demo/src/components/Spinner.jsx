import React from 'react';

export default function Spinner({ label = "Loading" }) {
  return (
    <div role="status" style={{ padding: "1rem 0", color: "var(--muted)" }}>
      <span>{label}…</span>
    </div>
  );
}
