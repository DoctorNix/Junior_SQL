import React, { useMemo, useState, useCallback, useEffect } from 'react';
import type { Database, QueryResult, Column, Schema } from '../engine/types.ts';
import { runSQL } from '../engine/sqlEngine.ts';

export type QueryPanelProps = {
  db: Database;
  setDB: (next: Database) => void;
  onResult: (r: QueryResult) => void;
  title?: string;
  disabled?: boolean; // disabled until tables exist
  defaultSQL?: string;
  showExamples?: boolean;
  // New: draft schema from builder to drive examples and optionally auto-sync SQL text
  schemaPreview?: Schema;
  autoSyncFromSchema?: boolean;
};

export default function QueryPanel({ db, setDB, onResult, title = '模块二：Query 空间', disabled, defaultSQL, showExamples = true, schemaPreview, autoSyncFromSchema }: QueryPanelProps) {
  const active = db.active;
  const hintedTable = schemaPreview?.tableName || active;
  const [sql, setSql] = useState<string>(defaultSQL || `SELECT * FROM ${hintedTable};`);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const tableName = useMemo(() => schemaPreview?.tableName || active, [schemaPreview, active]);
  const previewSig = useMemo(() => {
    if (!schemaPreview) return '';
    return (schemaPreview.columns || [])
      .map(c => `${c.name}:${c.type}:${c.length ?? ''}:${c.precision ?? ''}:${c.scale ?? ''}`)
      .join('|');
  }, [schemaPreview]);

  useEffect(() => {
    if (defaultSQL) return;
    setSql(prev => (prev?.trim().length ? prev : `SELECT * FROM ${tableName};`));
  }, [defaultSQL, tableName]);

  // Auto-sync query text from builder schema: SELECT col1, col2 FROM table;
  useEffect(() => {
    if (!autoSyncFromSchema || !schemaPreview) return;
    const cols = (schemaPreview.columns || []).map(c => c.name).filter(Boolean);
    const list = cols.length ? cols.join(', ') : '*';
    setSql(`SELECT ${list} FROM ${tableName};`);
  }, [autoSyncFromSchema, tableName, previewSig, schemaPreview]);

  const examples = useMemo(() => makeExamples(db, schemaPreview?.tableName || active, schemaPreview), [db, active, schemaPreview]);

  const onRun = useCallback(() => {
    if (disabled) return;
    setRunning(true);
    setError(null);
    try {
      const result = runSQL(sql, db, setDB);
      onResult(result);
    } catch (e: any) {
      setError(e?.message || String(e));
      onResult({ columns: ['error'], rows: [{ error: e?.message || String(e) }] });
    } finally {
      setRunning(false);
    }
  }, [sql, db, setDB, onResult, disabled]);

  // Ctrl/Cmd+Enter to run
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMeta = e.metaKey || e.ctrlKey;
    if (isMeta && e.key === 'Enter') {
      e.preventDefault();
      onRun();
    }
  };

  return (
    <section className="query-panel" aria-label="Query">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="nav-button" onClick={onRun} disabled={disabled || running}>
            {running ? '运行中…' : '▶ 运行'}
          </button>
        </div>
      </div>

      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        className="input"
        style={{ width: '100%', height: 180, borderRadius: 12, marginTop: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        placeholder={`SELECT * FROM ${active};`}
      />

      {showExamples && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {examples.map((ex) => (
            <button key={ex.name} className="nav-button" onClick={() => setSql(ex.sql)} disabled={disabled} title={ex.hint}>
              {ex.name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, color: '#e11d48', fontSize: 12 }}>错误：{error}</div>
      )}

      <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
        小提示：按 <kbd>Ctrl/⌘</kbd> + <kbd>Enter</kbd> 快速运行。
      </div>
    </section>
  );
}

// ------------------------------------
// Example SQLs (no JOIN / HAVING for now)
// ------------------------------------
function makeExamples(db: Database, table: string, override?: Schema) {
  const schema = override || db.schemas[table];
  const cols = schema?.columns || [];
  const cName = cols[0]?.name || 'id';
  const c2 = cols[1]?.name || cols[0]?.name || 'id';
  const numCol = cols.find(isNumericCol)?.name || c2;
  const txtCol = cols.find(isTextCol)?.name || c2;

  const list: { name: string; sql: string; hint?: string }[] = [];

  // 基础
  list.push({ name: '查全部', sql: `SELECT * FROM ${table};` });
  list.push({ name: '挑字段', sql: `SELECT ${[cName, c2].filter(Boolean).join(', ')} FROM ${table};` });
  list.push({ name: '条件 AND/OR', sql: `SELECT * FROM ${table} WHERE ${cName} = ${mockLiteral(cols[0]) || 1} OR ${c2} LIKE '%a%';`, hint: '支持 AND / OR / 括号 / LIKE / 比较' });
  list.push({ name: '排序多列', sql: `SELECT * FROM ${table} ORDER BY ${numCol} DESC, ${cName} ASC;` });

  // DISTINCT
  list.push({ name: 'DISTINCT', sql: `SELECT DISTINCT ${c2} FROM ${table} ORDER BY ${c2};`, hint: '去重后再排序' });

  // GROUP BY：选择一个非空列分组 + 可选聚合
  list.push({
    name: 'GROUP BY',
    sql: `SELECT ${c2} AS k, COUNT(*) AS cnt${numCol ? `, AVG(${numCol}) AS avg_v` : ''} FROM ${table} GROUP BY ${c2} ORDER BY cnt DESC;`,
  });

  // 取样当前表的值用于 IN/BETWEEN 示例
  const rows: any[] = ((db.rows as any)[table] as any[]) || [];
  const pickVals = sampleValues(rows, c2, 2);
  const pickNums = numCol ? sampleValues(rows, numCol, 2).map(Number).filter(n => !Number.isNaN(n)) : [];

  // IN / NOT IN（优先使用真实值样本）
  if (c2) {
    const inList = (pickVals.length ? pickVals : [mockLiteral(cols[1] || cols[0], 1), mockLiteral(cols[1] || cols[0], 2)])
      .map(v => (typeof v === 'string' && !/^'.*'$/.test(v) ? `'${v}'` : String(v)))
      .join(', ');
    list.push({ name: 'IN', sql: `SELECT * FROM ${table} WHERE ${c2} IN (${inList});` });
    list.push({ name: 'NOT IN', sql: `SELECT * FROM ${table} WHERE ${c2} NOT IN (${inList});` });
  }

  // BETWEEN（数值列优先，找两端范围）
  if (numCol) {
    const a = pickNums[0] ?? 10;
    const b = pickNums[1] ?? 50;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    list.push({ name: 'BETWEEN', sql: `SELECT * FROM ${table} WHERE ${numCol} BETWEEN ${lo} AND ${hi};` });
  }

  // IS NULL / IS NOT NULL（演示语法，即使当前数据无空也可执行）
  list.push({ name: 'IS NULL', sql: `SELECT * FROM ${table} WHERE ${c2} IS NULL;` });
  list.push({ name: 'IS NOT NULL', sql: `SELECT * FROM ${table} WHERE ${c2} IS NOT NULL;` });

  // LIMIT 扩展
  list.push({ name: 'LIMIT OFFSET', sql: `SELECT * FROM ${table} ORDER BY ${cName} LIMIT 3 OFFSET 2;`, hint: '跳过2条，取3条' });
  list.push({ name: 'LIMIT m,n', sql: `SELECT * FROM ${table} ORDER BY ${cName} LIMIT 2, 3;`, hint: '从第3条开始取3条（MySQL风格）' });

  // INSERT：构造一条基本插入
  if (cols.length) {
    const colList = cols.map(c => c.name).join(', ');
    const values = cols.map((c, i) => mockLiteral(c, i)).join(', ');
    list.push({ name: '插入一行', sql: `INSERT INTO ${table} (${colList}) VALUES (${values});` });

    // UPDATE：更新一行（按第一列当主键的思路示例）
    const pk = cols[0]?.name || 'id';
    const upCol = cols.find(isNumericCol) || cols.find(c => c.name !== pk) || cols[0];
    const sampleId = (rows[0]?.[pk] ?? 1);
    let setExpr = '';
    if (upCol) {
      if (isNumericCol(upCol)) {
        setExpr = `${upCol.name} = ${upCol.name} + 1`;
      } else {
        setExpr = `${upCol.name} = 'Updated'`;
      }
      list.push({ name: '更新一行', sql: `UPDATE ${table} SET ${setExpr} WHERE ${pk} = ${typeof sampleId === 'string' ? `'${sampleId}'` : sampleId};` });
    }
  }

  return list;
}

function isNumericCol(c: Column) {
  return c.type === 'INT' || c.type === 'INTEGER' || c.type === 'REAL' || c.type === 'DECIMAL';
}

function isTextCol(c: Column) {
  return c.type === 'TEXT' || c.type === 'CHAR' || c.type === 'VARCHAR';
}

function sampleValues(rows: any[], col: string, k: number): any[] {
  if (!rows || !rows.length) return [];
  const uniq = new Set<any>();
  const out: any[] = [];
  for (const r of rows) {
    const v = r?.[col];
    if (!uniq.has(v)) {
      uniq.add(v);
      out.push(v);
      if (out.length >= k) break;
    }
  }
  return out;
}

function mockLiteral(c?: Column, i?: number): string {
  if (!c) return '1';
  switch (c.type) {
    case 'INT':
    case 'INTEGER':
      return String(100 + (i ?? 0));
    case 'REAL':
    case 'DECIMAL':
      return '3.14';
    case 'BOOLEAN':
      return 'true';
    case 'CHAR':
    case 'VARCHAR':
    case 'TEXT':
    default: {
      const n = c.type === 'CHAR' || c.type === 'VARCHAR' ? (c.length ?? 6) : 6;
      const base = 'Value';
      const s = (base + '_' + (i ?? 0)).slice(0, Math.max(1, n));
      return `'${s}'`;
    }
  }
}
