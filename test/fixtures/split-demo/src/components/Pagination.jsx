import React from 'react';
import Button from './Button.jsx';

export default function Pagination({ page, pageCount, onChange }) {
  if (pageCount <= 1) return null;
  const numbers = [];
  for (let i = 1; i <= pageCount; i++) numbers.push(i);
  return (
    <nav aria-label="Pagination" style={{ display: "flex", gap: "0.25rem", margin: "1rem 0" }}>
      <Button
        variant="ghost"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Prev
      </Button>
      {numbers.map(n => (
        <Button
          key={n}
          variant={n === page ? "primary" : "ghost"}
          onClick={() => onChange(n)}
        >
          {n}
        </Button>
      ))}
      <Button
        variant="ghost"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
