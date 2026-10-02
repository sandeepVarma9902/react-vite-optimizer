import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import ShopRoutes from './shop/ShopRoutes.jsx';
import AdminRoutes from './admin/AdminRoutes.jsx';
import AccountRoutes from './account/AccountRoutes.jsx';
import { ShopProvider } from './context/ShopContext.jsx';
import Button from './components/Button.jsx';

function Home() {
  return (
    <div className="page">
      <h1>Split Demo Store</h1>
      <p>A demo storefront used to exercise the rvo split analyzer.</p>
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <Link to="/shop"><Button>Browse the shop</Button></Link>
        <Link to="/account"><Button variant="ghost">My account</Button></Link>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="page">
      <h1>404</h1>
      <p>That page does not exist.</p>
      <Link to="/">Back home</Link>
    </div>
  );
}

export default function App() {
  return (
    <ShopProvider>
      <nav className="topnav">
        <Link to="/">Home</Link>
        <Link to="/shop">Shop</Link>
        <Link to="/account">Account</Link>
        <Link to="/admin">Admin</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/shop/*" element={<ShopRoutes />} />
        <Route path="/admin/*" element={<AdminRoutes />} />
        <Route path="/account/*" element={<AccountRoutes />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ShopProvider>
  );
}
