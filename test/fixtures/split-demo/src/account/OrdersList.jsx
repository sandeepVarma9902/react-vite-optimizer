import React, { useEffect, useState } from 'react';
import { fetchOrders } from './accountApi.js';
import { useShop } from '../context/ShopContext.jsx';
import { formatPrice } from '../utils/format.js';
import Card from '../components/Card.jsx';
import Spinner from '../components/Spinner.jsx';

export default function OrdersList() {
  const { currency } = useShop();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders().then(list => {
      setOrders(list);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner label="Loading orders" />;

  return (
    <div>
      <h2>Order history</h2>
      {orders.length === 0 && <p>No orders yet.</p>}
      {orders.map(o => (
        <Card key={o.id}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <strong>Order {o.id}</strong>
              <p>{o.date} — {o.items} item(s) — {o.status}</p>
            </div>
            <strong>{formatPrice(o.total, currency)}</strong>
          </div>
        </Card>
      ))}
    </div>
  );
}
