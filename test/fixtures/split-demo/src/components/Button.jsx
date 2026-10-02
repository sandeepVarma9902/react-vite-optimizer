import React from 'react';

const styles = {
  base: { padding: '0.6rem 1.1rem', borderRadius: '8px', border: '1px solid transparent', cursor: 'pointer', fontWeight: 600 },
  primary: { background: 'var(--brand)', color: '#fff' },
  ghost: { background: 'transparent', borderColor: '#cbd5e1', color: 'var(--ink)' },
  danger: { background: '#dc2626', color: '#fff' },
};

export default function Button({ children, variant = "primary", type = "button", onClick, disabled }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{ ...styles.base, ...styles[variant], opacity: disabled ? 0.5 : 1 }}
    >
      {children}
    </button>
  );
}
