import React from 'react';
import type { Database } from '../engine/types.ts';

type Props = {
  db: Database;
  tableName: string;
  compact?: boolean;
  maxRows?: number; // optional soft cap for preview lists
};

export default function DataTable({ db, tableName, compact, maxRows }: Props) {
  const schema = db.schemas[tableName];
  const rows = db.rows[tableName] || [];

  if (!schema) {
    return (
      <div className="panel" style={{ marginTop: 0 }}>
        <div style={{ color: '#e11d48', fontSize: 12 }}>Unknown table: {tableName}</div>
      </div>
    );
  }

  const effectiveMaxRows = typeof maxRows === 'number' ? maxRows : rows.length;
  const bodyRows = rows.slice(0, effectiveMaxRows);
  const isEmpty = bodyRows.length === 0;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="result-table" style={compact ? { fontSize: 12 } : undefined}>
        <thead>
          <tr>
            {schema.columns.map((c) => (
              <th key={c.id}>
                {c.name}
                <span style={{ color: '#64748b', fontWeight: 400 }}> ({c.type}{c.primary ? ', PK' : ''})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={schema.columns.length} style={{ textAlign: 'center', color: '#64748b' }}>
                暂无数据。
              </td>
            </tr>
          ) : (
            bodyRows.map((r, i) => (
              <tr key={i}>
                {schema.columns.map((c) => (
                  <td key={c.id}>{formatCell(r[c.name])}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {rows.length > bodyRows.length ? (
        <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
          已显示 {bodyRows.length} / {rows.length} 行
        </div>
      ) : null}
    </div>
  );
}

function formatCell(v: any) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  // 简单截断特别长的字符串，避免撑爆表格
  if (s.length > 120) s = s.slice(0, 117) + '...';
  return s;
}
