import { create } from 'zustand';

export const useWishlist = create(set => ({
  items: [],
  toggle: product =>
    set(state => {
      const has = state.items.some(i => i.id === product.id);
      return {
        items: has ? state.items.filter(i => i.id !== product.id) : [...state.items, product],
      };
    }),
  has: id => false, // selector placeholder replaced below
}));

// Convenience selector hook.
export function useIsWishlisted(id) {
  return useWishlist(s => s.items.some(i => i.id === id));
}
