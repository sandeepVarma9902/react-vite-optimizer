import React from 'react';

export function UserCard({ user }) {
  return <div className="card">{user.name}</div>;
}

export default UserCard;
