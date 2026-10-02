import React from 'react';
import { Link } from 'react-router-dom';
import { useCart } from './useCart.js';
import { useShop } from '../context/ShopContext.jsx';
import { formatPrice } from '../utils/format.js';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

export default function CartPage() {
  const { items, remove, clear, total } = useCart();
  const { currency } = useShop();

  if (!items.length) {
    return (
      <div className="page">
        <h1>Your cart</h1>
        <p>Your cart is empty.</p>
        <Link to="/shop"><Button>Continue shopping</Button></Link>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Your cart</h1>
      {items.map(item => (
        <Card key={item.id}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <strong>{item.name}</strong>
              <p>Qty: {item.qty} × {formatPrice(item.price, currency)}</p>
            </div>
            <Button variant="ghost" onClick={() => remove(item.id)}>Remove</Button>
          </div>
        </Card>
      ))}
      <h2>Total: {formatPrice(total, currency)}</h2>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Button>Checkout</Button>
        <Button variant="ghost" onClick={clear}>Clear cart</Button>
      </div>
    </div>
  );
}
