const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchOrders() {
  await wait(50);
  return [
    { id: 'ORD-1042', date: '2026-08-14', items: 2, total: 178, status: 'delivered' },
    { id: 'ORD-1037', date: '2026-07-30', items: 1, total: 49, status: 'delivered' },
    { id: 'ORD-1029', date: '2026-07-02', items: 3, total: 420, status: 'returned' },
  ];
}

export async function fetchAddresses() {
  await wait(50);
  return [];
}
