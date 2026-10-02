import React from 'react';
import { Routes, Route } from 'react-router-dom';
import ShopHome from './ShopHome.jsx';
import CartPage from './CartPage.jsx';
import ProductDetail from './ProductDetail.jsx';
import ProductReviews from './ProductReviews.jsx';
import WishlistPage from './WishlistPage.jsx';
import ProductComparison from './ProductComparison.jsx';

export default function ShopRoutes() {
  return (
    <Routes>
      <Route index element={<ShopHome />} />
      <Route path="cart" element={<CartPage />} />
      <Route path=":productId" element={<ProductDetail />} />
      <Route path=":productId/reviews" element={<ProductReviews />} />
      <Route path="wishlist" element={<WishlistPage />} />
      <Route path="compare" element={<ProductComparison />} />
    </Routes>
  );
}
