import React from 'react';

export default function ExpensiveList({ items, query }) {
  const filtered = items.filter(i => i.name.includes(query)).map(i => i.name);
  return (
    <ul>
      {filtered.map(f => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
}
