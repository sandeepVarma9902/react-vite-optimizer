export default function UserCard({ user }) {
  return (
    <div>
      <strong>{user.name}</strong>
      <span>{user.email}</span>
    </div>
  );
}
