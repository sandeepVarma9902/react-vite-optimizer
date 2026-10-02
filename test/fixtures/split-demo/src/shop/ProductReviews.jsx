import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchReviews } from './shopApi.js';
import Card from '../components/Card.jsx';
import Spinner from '../components/Spinner.jsx';

export default function ProductReviews() {
  const { productId } = useParams();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReviews(productId).then(list => {
      setReviews(list);
      setLoading(false);
    });
  }, [productId]);

  return (
    <div className="page">
      <Link to={`/shop/${productId}`}>← Back to product</Link>
      <h1>Reviews</h1>
      {loading && <Spinner label="Loading reviews" />}
      {!loading && reviews.length === 0 && <p>No reviews yet.</p>}
      {reviews.map(r => (
        <Card key={r.id}>
          <p><strong>{r.author}</strong> — {r.rating}/5</p>
          <p>{r.body}</p>
        </Card>
      ))}
    </div>
  );
}
