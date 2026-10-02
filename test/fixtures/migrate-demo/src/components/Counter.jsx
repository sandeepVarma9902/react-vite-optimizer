import React, { useState, useEffect } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    document.title = `Count: ${count}`;
  }, []);

  useEffect(() => {
    console.log('count changed', count);
  }, [count]);

  const increment = () => {
    setCount(count + 1);
  };

  const bump = () => setCount(c => c + 1);

  return (
    <div className="counter">
      <p>Current: {count}</p>
      {count > 5 && <p className="warn">Getting big!</p>}
      <button onClick={increment}>Add</button>
      <button onClick={bump}>Bump</button>
    </div>
  );
}
