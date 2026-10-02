import React, { useState } from 'react';

export default function Counter({ start }) {
  const [n, setN] = useState(start);
  return <button onClick={() => setN(n + 1)}>count: {n}</button>;
}
