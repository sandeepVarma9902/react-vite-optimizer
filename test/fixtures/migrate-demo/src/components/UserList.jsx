import React from 'react';

export default function UserList({ users, title }) {
  const handleSelect = user => {
    console.log('selected', user.name);
  };

  return (
    <section>
      <h2>{title}</h2>
      {users.length === 0 ? (
        <p>No users yet.</p>
      ) : (
        <ul>
          {users.map(user => (
            <li key={user.id} onClick={() => handleSelect(user)}>
              {user.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
