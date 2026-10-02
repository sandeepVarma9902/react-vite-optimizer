// Demo catalog API — in a real app this would call a backend.
const PRODUCTS = [
  { id: 'p1', name: 'Aurora Lamp', blurb: 'A warm desk lamp.', price: 49, rating: 4.5, reviewCount: 12, description: 'Hand-finished lamp with a warm 2700K glow.' },
  { id: 'p2', name: 'Nimbus Chair', blurb: 'Ergonomic office chair.', price: 299, rating: 4.8, reviewCount: 34, description: 'Mesh back, lumbar support, silent casters.' },
  { id: 'p3', name: 'Drift Keyboard', blurb: 'Low-profile mechanical.', price: 129, rating: 4.6, reviewCount: 21, description: 'Hot-swappable switches, PBT keycaps.' },
];

const REVIEWS = {
  p1: [{ id: 'r1', author: 'Maya', rating: 5, body: 'Lovely warm light.' }],
  p2: [{ id: 'r2', author: 'Dev', rating: 5, body: 'My back thanks me.' }],
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchProducts() {
  await wait(50);
  return PRODUCTS;
}

export async function fetchProduct(id) {
  await wait(50);
  return PRODUCTS.find(p => p.id === id) || null;
}

export async function fetchReviews(productId) {
  await wait(50);
  return REVIEWS[productId] || [];
}
