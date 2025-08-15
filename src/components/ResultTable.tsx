import React from 'react';
import type { QueryResult } from '../engine/types';

export type ResultTableProps = {
  result: QueryResult | null;
  title?: string;
  compact?: boolean;
  /**
   * Preferred maximum height for the scroll area (in px). If provided, vertical
   * scrolling is enabled when content exceeds this height.
   */
  maxHeight?: number;
  /**
   * Preferred minimum height for the table area (in px). Useful for making
   * both columns look equally tall without forcing scrolling.
   */
  minHeight?: number;
  /** Soft cap for visible rows (slice in-memory rows before render). */
  maxRows?: number;
};

export default function ResultTable({ result, title = '查询结果', compact, maxHeight, minHeight, maxRows }: ResultTableProps) {
  if (!result) {
    return (
      <div className="panel" style={{ marginTop: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>还没有结果，先运行一个查询吧～</div>
      </div>
    );
  }

  const { columns, rows } = result;
  const limit = typeof maxRows === 'number' ? maxRows : rows.length;
  const displayRows = rows.slice(0, limit);
  const isEmpty = !rows || rows.length === 0;

  // 如果返回的是 message/error 单列，做友好提示呈现
  const singleMsgKey = columns.length === 1 && (columns[0] === 'message' || columns[0] === 'error') ? columns[0] : null;

  return (
    <div className="panel" style={{ marginTop: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div style={{ fontSize: 12, color: '#64748b' }}>显示 {displayRows.length} / {rows?.length ?? 0} 行 · {columns?.length ?? 0} 列</div>
      </div>

      {singleMsgKey ? (
        <div style={{ marginTop: 8, fontSize: 13, color: singleMsgKey === 'error' ? '#e11d48' : '#0f766e' }}>
          {rows?.[0]?.[singleMsgKey] ?? ''}
        </div>
      ) : (
        <div
          style={{
            marginTop: 8,
            overflowX: 'auto',
            overflowY: typeof maxHeight === 'number' ? 'auto' : 'visible',
            ...(typeof minHeight === 'number' ? { minHeight } : {}),
            ...(typeof maxHeight === 'number' ? { maxHeight } : {}),
            flex: 1,
          }}
        >
          <table className="result-table" style={compact ? { fontSize: 12 } : undefined}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, left: 0, background: '#d1fae5', zIndex: 1 }}>#</th>
                {columns.map((c) => (
                  <th key={c} style={{ position: 'sticky', top: 0, background: '#d1fae5' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isEmpty ? (
                <tr>
                  <td colSpan={columns.length + 1} style={{ textAlign: 'center', color: '#64748b' }}>（空集）</td>
                </tr>
              ) : (
                displayRows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ color: '#64748b' }}>{i + 1}</td>
                    {columns.map((c) => (
                      <td key={c} style={{ wordBreak: 'break-word' }}>{formatCell((r as any)[c])}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {rows.length > limit && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
              已显示前 {displayRows.length} 行，其余行请通过查询条件或导出查看。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatCell(v: any) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (s.length > 150) s = s.slice(0, 147) + '...';
  return s;
}
