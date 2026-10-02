import React from 'react';

const tones = {
  plain: { border: '1px solid #e2e8f0', background: 'var(--surface)' },
  danger: { border: '1px solid #fecaca', background: '#fef2f2' },
  info: { border: '1px solid #bfdbfe', background: '#eff6ff' },
};

export default function Card({ children, tone = "plain" }) {
  return (
    <div
      style={{
        ...tones[tone],
        borderRadius: 'var(--radius)',
        padding: '1rem 1.25rem',
        marginBottom: '0.75rem',
      }}
    >
      {children}
    </div>
  );
}
