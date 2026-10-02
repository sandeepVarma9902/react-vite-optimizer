import { useCartStore } from './cartStore.js';

// Ergonomic hook over the zustand cart store.
export function useCart() {
  const items = useCartStore(s => s.items);
  const add = useCartStore(s => s.add);
  const remove = useCartStore(s => s.remove);
  const clear = useCartStore(s => s.clear);
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const count = items.reduce((sum, i) => sum + i.qty, 0);
  return { items, add, remove, clear, total, count };
}
