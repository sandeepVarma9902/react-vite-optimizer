import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchProduct } from './shopApi.js';
import { useCart } from './useCart.js';
import { useShop } from '../context/ShopContext.jsx';
import { formatPrice } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Button from '../components/Button.jsx';

export default function ProductDetail() {
  const { productId } = useParams();
  const { add } = useCart();
  const { currency } = useShop();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchProduct(productId).then(p => {
      if (!cancelled) {
        setProduct(p);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [productId]);

  if (loading) return <div className="page"><Spinner label="Loading product" /></div>;
  if (!product) return <div className="page"><p>Product not found.</p></div>;

  return (
    <div className="page">
      <Link to="/shop">← Back to shop</Link>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
      <p><strong>{formatPrice(product.price, currency)}</strong></p>
      <p>Rating: {product.rating} / 5 ({product.reviewCount} reviews)</p>
      <Button onClick={() => add(product)}>Add to cart</Button>
      <Link to={`/shop/${product.id}/reviews`}>
        <Button variant="ghost">Read reviews</Button>
      </Link>
    </div>
  );
}
