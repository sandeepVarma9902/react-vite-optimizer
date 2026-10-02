import React, { useState } from 'react';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

const SEED = [
  { id: 'a1', label: 'Home', lines: '221 Baker Street, Bengaluru 560001' },
  { id: 'a2', label: 'Office', lines: 'Koramangala, Bengaluru 560095' },
];

export default function AddressBook() {
  const [addresses, setAddresses] = useState(SEED);
  const [label, setLabel] = useState("");
  const [lines, setLines] = useState("");

  const add = ev => {
    ev.preventDefault();
    if (!label.trim() || !lines.trim()) return;
    setAddresses([...addresses, { id: `a${Date.now()}`, label, lines }]);
    setLabel("");
    setLines("");
  };

  const remove = id => setAddresses(addresses.filter(a => a.id !== id));

  return (
    <div>
      <h2>Addresses</h2>
      {addresses.map(a => (
        <Card key={a.id}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <strong>{a.label}</strong>
              <p>{a.lines}</p>
            </div>
            <Button variant="ghost" onClick={() => remove(a.id)}>Remove</Button>
          </div>
        </Card>
      ))}
      <Card>
        <h3>Add address</h3>
        <form onSubmit={add}>
          <input placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} />
          <input placeholder="Address" value={lines} onChange={e => setLines(e.target.value)} />
          <Button type="submit">Add</Button>
        </form>
      </Card>
    </div>
  );
}
