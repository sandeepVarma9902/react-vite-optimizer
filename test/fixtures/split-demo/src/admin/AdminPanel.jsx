import React, { useState } from 'react';
// NOTE: the ops panel reuses shop internals directly — flagged by rvo split
// as a cross-feature coupling risk.
import ProductCard from '../shop/ProductCard.jsx';
import { fetchProducts } from '../shop/shopApi.js';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';
import Modal from '../components/Modal.jsx';
import Tabs from '../components/Tabs.jsx';

const FLAGS = [
  { id: 'new-checkout', label: 'New checkout flow', on: true },
  { id: 'reviews-v2', label: 'Reviews v2', on: false },
  { id: 'guest-cart', label: 'Guest cart', on: true },
];

export default function AdminPanel() {
  const [flags, setFlags] = useState(FLAGS);
  const [preview, setPreview] = useState(null);

  const toggle = id =>
    setFlags(flags.map(f => (f.id === id ? { ...f, on: !f.on } : f)));

  const previewProduct = async () => {
    const list = await fetchProducts();
    setPreview(list[0]);
  };

  return (
    <div className="page">
      <h1>Ops panel</h1>
      <Tabs tabs={[{ id: 'flags', label: 'Flags' }, { id: 'preview', label: 'Preview' }]} active="flags" onChange={() => {}} />
      <h2>Feature flags</h2>
      {flags.map(f => (
        <Card key={f.id}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{f.label}</span>
            <Button variant="ghost" onClick={() => toggle(f.id)}>
              {f.on ? "Disable" : "Enable"}
            </Button>
          </div>
        </Card>
      ))}
      <h2>Storefront preview</h2>
      <p>Renders the real shop ProductCard inside admin — tight coupling.</p>
      <Button onClick={previewProduct}>Load preview</Button>
      {preview && <ProductCard product={preview} />}
      <Modal open={false} onClose={() => {}}>
        <p>Unused modal placeholder.</p>
      </Modal>
    </div>
  );
}
