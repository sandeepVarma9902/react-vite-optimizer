import React, { useState } from 'react';
import { LineChart } from 'recharts';

export default function Dashboard() {
  const [data] = useState([{ v: 1 }, { v: 2 }]);
  return (
    <div>
      <h1>Dashboard</h1>
      <LineChart data={data} />
    </div>
  );
}
