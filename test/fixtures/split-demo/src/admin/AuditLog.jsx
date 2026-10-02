import React, { useEffect, useMemo, useState } from 'react';
import DataTable from '../components/DataTable.jsx';
import Pagination from '../components/Pagination.jsx';
import Spinner from '../components/Spinner.jsx';
import { useDebounce } from '../hooks/useDebounce.js';

const COLUMNS = [
  { key: 'at', label: 'Time' },
  { key: 'actor', label: 'Actor' },
  { key: 'action', label: 'Action' },
  { key: 'target', label: 'Target' },
];

function seedLog() {
  const actors = ["asha@example.com", "cara@example.com", "system"];
  const actions = ["user.promote", "flag.toggle", "settings.save", "refund.issue"];
  const rows = [];
  for (let i = 0; i < 42; i++) {
    rows.push({
      id: 'evt-' + i,
      at: '2026-09-' + String((i % 28) + 1).padStart(2, '0') + ' 10:0' + (i % 10) + ':00',
      actor: actors[i % actors.length],
      action: actions[i % actions.length],
      target: 'res-' + (1000 + i),
    });
  }
  return rows;
}

const PAGE_SIZE = 10;

export default function AuditLog() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(null);
  const debounced = useDebounce(query, 250);

  useEffect(() => {
    const t = setTimeout(() => setRows(seedLog()), 120);
    return () => clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = debounced.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      [r.actor, r.action, r.target].some(v => v.toLowerCase().includes(q))
    );
  }, [rows, debounced]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="page">
      <h1>Audit log</h1>
      <input
        type="search"
        placeholder="Filter by actor, action, target…"
        value={query}
        onChange={e => { setQuery(e.target.value); setPage(1); }}
      />
      {!rows && <Spinner label="Loading audit log" />}
      {rows && (
        <>
          <DataTable columns={COLUMNS} rows={visible} />
          <Pagination page={safePage} pageCount={pageCount} onChange={setPage} />
          <p>{filtered.length} event(s)</p>
        </>
      )}
    </div>
  );
}
