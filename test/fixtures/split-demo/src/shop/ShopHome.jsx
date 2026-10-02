import React, { useEffect, useState } from 'react';
import { useShop } from '../context/ShopContext.jsx';
import ProductList from './ProductList.jsx';
import { fetchProducts } from './shopApi.js';
import Spinner from '../components/Spinner.jsx';
import Card from '../components/Card.jsx';

export default function ShopHome() {
  const { currency } = useShop();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProducts()
      .then(list => {
        if (!cancelled) {
          setProducts(list);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const visible = products.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="page">
      <h1>Shop</h1>
      <p>Prices shown in {currency}.</p>
      <input
        type="search"
        placeholder="Search products…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {loading && <Spinner label="Loading products" />}
      {error && (
        <Card tone="danger">
          <p>Could not load products: {error}</p>
        </Card>
      )}
      {!loading && !error && <ProductList products={visible} />}
      {!loading && !error && visible.length === 0 && (
        <p>No products match your search.</p>
      )}
    </div>
  );
}
