import React, { useMemo, useState } from 'react';
import { fetchProducts } from './shopApi.js';
import { useShop } from '../context/ShopContext.jsx';
import { formatPrice } from '../utils/format.js';
import Card from '../components/Card.jsx';
import Button from '../components/Button.jsx';
import Spinner from '../components/Spinner.jsx';

export default function ProductComparison() {
  const { currency } = useShop();
  const [catalog, setCatalog] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = useState([]);

  React.useEffect(() => {
    fetchProducts().then(list => {
      setCatalog(list);
      setLoading(false);
    });
  }, []);

  const toggleSelect = id =>
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev.slice(-2), id]
    );

  const compared = useMemo(
    () => catalog.filter(p => selected.includes(p.id)),
    [catalog, selected]
  );

  const rows = useMemo(() => {
    if (compared.length < 2) return [];
    const keys = ["price", "rating", "reviewCount"];
    return keys.map(k => ({
      label: k,
      values: compared.map(p => (k === 'price' ? formatPrice(p[k], currency) : String(p[k]))),
    }));
  }, [compared, currency]);

  if (loading) return <div className="page"><Spinner label="Loading catalog" /></div>;

  return (
    <div className="page">
      <h1>Compare products</h1>
      <p>Pick up to three products to compare side by side.</p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {catalog.map(p => (
          <Button
            key={p.id}
            variant={selected.includes(p.id) ? "primary" : "ghost"}
            onClick={() => toggleSelect(p.id)}
          >
            {p.name}
          </Button>
        ))}
      </div>
      {compared.length >= 2 && (
        <Card>
          <table>
            <thead>
              <tr>
                <th>Attribute</th>
                {compared.map(p => (
                  <th key={p.id}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label}>
                  <td><strong>{r.label}</strong></td>
                  {r.values.map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {compared.length < 2 && <p>Select at least two products.</p>}
    </div>
  );
}
