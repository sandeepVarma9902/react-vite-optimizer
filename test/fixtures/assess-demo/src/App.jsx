import { Routes, Route, Link } from 'react-router-dom';
import UserList from './components/UserList';
import Editor from './components/Editor';
import LegacyWidget from './components/LegacyWidget';

function Home() {
  return <h1>Welcome home</h1>;
}

function About() {
  return <h1>About this demo</h1>;
}

export default function App() {
  return (
    <div>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
        <Link to="/users">Users</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/users" element={<UserList />} />
      </Routes>
      <Editor />
      <LegacyWidget />
    </div>
  );
}
