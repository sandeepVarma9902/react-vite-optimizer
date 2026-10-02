import React from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/Card.jsx';
import Button from '../components/Button.jsx';
import { useCart } from './useCart.js';
import { formatPrice } from '../utils/format.js';
import { useShop } from '../context/ShopContext.jsx';

export default function ProductCard({ product }) {
  const { add } = useCart();
  const { currency } = useShop();

  return (
    <Card>
      <h3>{product.name}</h3>
      <p>{product.blurb}</p>
      <p><strong>{formatPrice(product.price, currency)}</strong></p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Link to={`/shop/${product.id}`}>
          <Button variant="ghost">Details</Button>
        </Link>
        <Button onClick={() => add(product)}>Add to cart</Button>
      </div>
    </Card>
  );
}
