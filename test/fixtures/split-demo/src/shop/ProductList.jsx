import React from 'react';
import ProductCard from './ProductCard.jsx';

export default function ProductList({ products }) {
  if (!products.length) {
    return <p>The catalog is empty right now.</p>;
  }
  return (
    <div className="grid">
      {products.map(p => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
