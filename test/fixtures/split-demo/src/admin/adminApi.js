// Demo admin API.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchAdminStats() {
  await wait(50);
  return { revenue: 128400, orders: 3421, users: 18772, refunds: 41 };
}

export async function fetchUsers() {
  await wait(50);
  return [
    { id: 'u1', name: 'Asha Rao', email: 'asha@example.com', role: 'customer', joined: '2024-02-11' },
    { id: 'u2', name: 'Ben Carter', email: 'ben@example.com', role: 'customer', joined: '2024-05-03' },
    { id: 'u3', name: 'Cara Diaz', email: 'cara@example.com', role: 'support', joined: '2023-11-19' },
  ];
}

export async function updateUserRole(id, role) {
  await wait(50);
  return { id, role };
}
