import React from 'react';

export default function DataTable({ columns, rows, emptyText = "No rows." }) {
  if (!rows.length) return <p>{emptyText}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th
                key={c.key}
                style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid #e2e8f0" }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id || JSON.stringify(r)}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: "0.5rem", borderBottom: "1px solid #f1f5f9" }}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
