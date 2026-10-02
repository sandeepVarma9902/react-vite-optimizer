import React from 'react';
import { Link } from 'react-router-dom';
import { useWishlist } from './wishlistStore.js';
import { useShop } from '../context/ShopContext.jsx';
import { formatPrice } from '../utils/format.js';
import Button from '../components/Button.jsx';
import Card from '../components/Card.jsx';

export default function WishlistPage() {
  const { items, toggle } = useWishlist();
  const { currency } = useShop();

  return (
    <div className="page">
      <h1>Wishlist</h1>
      {items.length === 0 && (
        <Card>
          <p>Your wishlist is empty.</p>
          <Link to="/shop"><Button>Discover products</Button></Link>
        </Card>
      )}
      <div className="grid">
        {items.map(p => (
          <Card key={p.id}>
            <h3>{p.name}</h3>
            <p><strong>{formatPrice(p.price, currency)}</strong></p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Link to={`/shop/${p.id}`}>
                <Button variant="ghost">View</Button>
              </Link>
              <Button variant="ghost" onClick={() => toggle(p)}>Remove</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
