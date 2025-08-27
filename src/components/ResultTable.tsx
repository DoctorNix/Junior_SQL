import React from 'react';
import type { QueryResult } from '../engine/types';

export type ResultTableProps = {
  result: QueryResult | null;
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
  /** Ensure at least this many row slots are visible by padding with placeholders. */
  minRows?: number;
  /** Placeholder row height (px). */
  rowHeight?: number;
  /** Optional style overrides for the outer panel container (useful to align with page grid width). */
  containerStyle?: React.CSSProperties;
};

export default function ResultTable({ result, compact, maxHeight, minHeight, maxRows, minRows = 10, rowHeight = 32, containerStyle }: ResultTableProps) {
  if (!result) {
    return (
      <div
        className="panel"
        style={{
          marginTop: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minWidth: 0,
          width: '100%', // default to full width; parent can override via containerStyle
          boxSizing: 'border-box',
          alignSelf: 'stretch',
          minHeight: minHeight ?? 240,
          justifyContent: 'flex-start',
          paddingTop: 8,
          ...containerStyle,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-start', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            结果显示
            <span style={{ fontSize: 16, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>
              （Result Table）
            </span>
          </h2>
        </div>
        <div style={{ fontSize: 14, color: '#64748b', textAlign: 'left', marginTop: 12 }}>
          此模块功能为展示你的 table 结果（目前暂无数据）
        </div>
      </div>
    );
  }

  const { columns, rows } = result;
  const limit = typeof maxRows === 'number' ? maxRows : rows.length;
  const displayRows = rows.slice(0, limit);
  const isEmpty = !rows || rows.length === 0;

  const needPlaceholders = Math.max(0, (isFinite(minRows) ? minRows : 0) - displayRows.length);
  const tableStyle: React.CSSProperties = {
    tableLayout: 'fixed',
    width: '100%',
    fontSize: compact ? 12 : 14,
  };

  // 如果返回的是 message/error 单列，做友好提示呈现
  const singleMsgKey = columns.length === 1 && (columns[0] === 'message' || columns[0] === 'error') ? columns[0] : null;

  return (
    <div className="panel" style={{ 
      marginTop: 0, 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      minWidth: 0,
      width: '100%', // default to full width; parent can override via containerStyle
      boxSizing: 'border-box', 
      alignSelf: 'stretch',
      ...containerStyle,
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          结果显示
          <span style={{ fontSize: 16, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>
            （Result Table）
          </span>
        </h2>
        <div style={{ fontSize: 14, color: '#64748b' }}>
          显示 {displayRows.length} / {rows?.length ?? 0} 行 · {columns?.length ?? 0} 列
        </div>
      </div>
      <div style={{ fontSize: 14, color: '#64748b', textAlign: 'center', marginTop: 8 }}>
        此模块功能为展示你的 table 结果
      </div>

      {singleMsgKey ? (
        <div style={{ marginTop: 8, fontSize: 15, color: singleMsgKey === 'error' ? '#e11d48' : '#0f766e' }}>
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
            width: '100%', // explicit full width
            minWidth: 0,
            boxSizing: 'border-box',
            display: 'block',
          }}
        >
          <table className="result-table" style={tableStyle}>
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
                <>
                {displayRows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ color: '#64748b' }}>{i + 1}</td>
                    {columns.map((c) => (
                      <td key={c} style={{ wordBreak: 'break-word' }}>{formatCell((r as any)[c])}</td>
                    ))}
                  </tr>
                ))}
                {needPlaceholders > 0 && Array.from({ length: needPlaceholders }).map((_, k) => (
                  <tr key={`ph-${k}`} aria-hidden="true" style={{ opacity: 0.3 }}>
                    <td style={{ height: rowHeight }}>&nbsp;</td>
                    {columns.map((c, j) => (
                      <td key={`phc-${k}-${j}`} style={{ height: rowHeight }}>&nbsp;</td>
                    ))}
                  </tr>
                ))}
                </>
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
