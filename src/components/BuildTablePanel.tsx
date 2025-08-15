import React from 'react';
import type { Schema, Column, ColType, Database } from '../engine/types.ts';
import { uid } from '../utils/helpers.ts';
import { runSQL } from '../engine/sqlEngine.ts';

// ------------------------------------
// Props
// ------------------------------------
export type BuildTablePanelProps = {
  schema: Schema;
  onSchemaChange: (next: Schema) => void;
  onApply?: () => void; // optional: apply to DB
  applyLabel?: string;
  disabled?: boolean;
  db?: Database;
  setDB?: (next: Database) => void;
};

// ------------------------------------
// Component
// ------------------------------------
export default function BuildTablePanel({ schema, onSchemaChange, onApply, applyLabel = '应用到数据库', disabled, db, setDB }: BuildTablePanelProps) {
  const setTableName = (name: string) => {
    onSchemaChange({ ...schema, tableName: normalizeName(name) });
  };

  const addColumn = () => {
    const next: Column = {
      id: uid(),
      name: suggestColName(schema),
      type: 'TEXT',
    };
    onSchemaChange({ ...schema, columns: [...schema.columns, next] });
  };

  const removeColumn = (id: string) => {
    onSchemaChange({ ...schema, columns: schema.columns.filter(c => c.id !== id) });
  };

  const updateColumn = (id: string, patch: Partial<Column>) => {
    const cols = schema.columns.map(c => (c.id === id ? { ...c, ...patch } : c));
    onSchemaChange({ ...schema, columns: cols });
  };

  const setPrimary = (id: string, pk: boolean) => {
    const cols = schema.columns.map(c => ({ ...c, primary: c.id === id ? pk : false }));
    onSchemaChange({ ...schema, columns: cols });
  };

  const createSQL = generateCreateSQL(schema);

  // ------------------------------
  // Batch insert (数据录入，合并到创造 Table)
  // ------------------------------
  const [batchRows, setBatchRows] = React.useState<Record<string, string>[]>([{}]);

  // when schema changes, keep objects but ensure shape; don't drop user values
  React.useEffect(() => {
    setBatchRows(rows => rows.map(r => ({ ...r })));
  }, [schema.tableName, schema.columns.map(c => c.id).join(',')]);

  function setCell(rowIdx: number, colName: string, v: string) {
    setBatchRows(prev => prev.map((r, i) => (i === rowIdx ? { ...r, [colName]: v } : r)));
  }
  function addRow() { setBatchRows(prev => [...prev, {}]); }
  function removeRow(i: number) { setBatchRows(prev => prev.filter((_, idx) => idx !== i)); }
  function clearAll() { setBatchRows([{}]); }

  function literalForSQL(col: Column, raw: string): string {
    const t = col.type;
    if (raw == null || raw.trim() === '') return 'NULL';
    if (t === 'INT' || t === 'INTEGER' || t === 'REAL' || t === 'DECIMAL') return String(raw).trim();
    if (t === 'BOOLEAN') {
      const v = raw.trim().toLowerCase();
      if (v === 'true' || v === '1' || v === 'yes') return 'true';
      if (v === 'false' || v === '0' || v === 'no') return 'false';
      return 'false';
    }
    const escaped = String(raw).replace(/'/g, "''");
    return `'${escaped}'`;
  }

  function hasAnyValue(r: Record<string, string>): boolean {
    return schema.columns.some(c => (r[c.name] ?? '').toString().trim() !== '');
  }

  function buildInsertSQLs(): string[] {
    const cols = schema.columns.map(c => c.name);
    return batchRows
      .filter(hasAnyValue)
      .map(r => {
        const vals = schema.columns.map(c => literalForSQL(c, r[c.name] ?? ''));
        return `INSERT INTO ${schema.tableName} (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
      });
  }

  function buildCombinedInsertSQL(): string {
    const cols = schema.columns.map(c => c.name);
    const tuples = batchRows
      .filter(hasAnyValue)
      .map(r => `(${schema.columns.map(c => literalForSQL(c, r[c.name] ?? '')).join(', ')})`);
    if (!tuples.length) return '';
    return `INSERT INTO ${schema.tableName} (${cols.join(', ')}) VALUES ${tuples.join(', ')};`;
  }

  function execBatchInsert() {
    if (!db || !setDB) return;
    // ensure table exists; if not, attempt to create via onApply
    if (!db.schemas[schema.tableName]) {
      onApply?.();
    }
    const sql = buildCombinedInsertSQL();
    if (!sql) return;
    try {
      runSQL(sql, db, setDB);
      // reset inputs after success
      clearAll();
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <section className="panel" aria-label="Build Table">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>模块一：创造 Table</h2>
        {onApply && (
          <button className="nav-button" onClick={onApply} disabled={disabled}>
            {applyLabel}
          </button>
        )}
      </div>

      {/* Table name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>表名</span>
        <input
          value={schema.tableName}
          onChange={(e) => setTableName(e.target.value)}
          placeholder="my_table"
          className="input"
          style={{ flex: 1, minWidth: 160 }}
        />
      </div>

      {/* Columns editor */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>列</span>
          <button className="nav-button" onClick={addColumn} disabled={disabled}>+ 添加列</button>
        </div>

        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
          {schema.columns.map((c, idx) => (
            <div key={c.id} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'auto 1fr auto auto auto auto auto' }}>
              <span style={{ alignSelf: 'center', fontSize: 12, color: '#94a3b8' }}>#{idx + 1}</span>

              {/* name */}
              <input
                value={c.name}
                onChange={(e) => updateColumn(c.id, { name: normalizeName(e.target.value) })}
                placeholder={`col_${idx + 1}`}
                className="input"
              />

              {/* type */}
              <select
                value={c.type}
                onChange={(e) => {
                  const t = e.target.value as ColType;
                  const base: Partial<Column> = { type: t };
                  // clear params when switching types
                  if (t === 'CHAR' || t === 'VARCHAR') {
                    base.length = c.length ?? 10;
                    delete (base as any).precision;
                    delete (base as any).scale;
                  } else if (t === 'DECIMAL') {
                    base.precision = c.precision ?? 10;
                    base.scale = c.scale ?? 2;
                    delete (base as any).length;
                  } else {
                    delete (base as any).length;
                    delete (base as any).precision;
                    delete (base as any).scale;
                  }
                  if (t === 'DECIMAL' && typeof base.precision === 'number' && typeof base.scale === 'number') {
                    base.scale = Math.max(0, Math.min(base.precision, base.scale));
                  }
                  updateColumn(c.id, base);
                }}
                className="input"
              >
                {['INT','INTEGER','REAL','DECIMAL','TEXT','CHAR','VARCHAR','BOOLEAN'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              {/* params for CHAR/VARCHAR */}
              {(c.type === 'CHAR' || c.type === 'VARCHAR') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>len</span>
                  <input
                    type="number"
                    min={1}
                    value={c.length ?? 10}
                    onChange={(e) => updateColumn(c.id, { length: clampInt(e.target.value, 1, 1024) })}
                    className="input"
                    style={{ width: 80 }}
                  />
                </div>
              )}

              {/* params for DECIMAL */}
              {c.type === 'DECIMAL' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>p</span>
                  <input
                    type="number"
                    min={1}
                    value={c.precision ?? 10}
                    onChange={(e) => {
                      const p = clampInt(e.target.value, 1, 38);
                      const current = schema.columns.find(x=>x.id===c.id);
                      const nextScale = Math.min(current?.scale ?? 2, p);
                      updateColumn(c.id, { precision: p, scale: nextScale });
                    }}
                    className="input"
                    style={{ width: 68 }}
                  />
                  <span style={{ fontSize: 12, color: '#64748b' }}>, s</span>
                  <input
                    type="number"
                    min={0}
                    value={c.scale ?? 2}
                    onChange={(e) => updateColumn(c.id, { scale: clampInt(e.target.value, 0, (schema.columns.find(x=>x.id===c.id)?.precision ?? 10)) })}
                    className="input"
                    style={{ width: 68 }}
                  />
                </div>
              )}

              {/* PK */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={!!c.primary}
                  onChange={(e) => setPrimary(c.id, e.target.checked)}
                />
                PK
              </label>

              {/* remove */}
              <button className="nav-button" onClick={() => removeColumn(c.id)} disabled={disabled}>
                删除
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* SQL preview */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>SQL 预览</div>
        <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{createSQL}</pre>
      </div>

      {/* Data entry (batch) */}
      <div style={{ marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
        <h3 className="section-title" style={{ margin: 0 }}>数据录入（批量，需先创建表）</h3>
        {!db || !setDB ? (
          <div className="code-block" style={{ marginTop: 8, background: '#fffaf0' }}>此页面未传入数据库上下文，无法直接插入。</div>
        ) : !db.schemas[schema.tableName] ? (
          <div style={{ marginTop: 8 }}>
            <div className="code-block" style={{ background: '#fffaf0' }}>还没有创建表 <b>{schema.tableName}</b>。请先点击上方“{applyLabel}”。</div>
            <button className="nav-button" style={{ marginTop: 8 }} onClick={() => onApply?.()}>现在创建空表</button>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            {batchRows.map((row, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'end', marginBottom: 8 }}>
                {schema.columns.map(c => (
                  <label key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, color: '#475569' }}>{c.name} <span style={{ color: '#94a3b8' }}>({c.type})</span></span>
                    <input className="input" value={row[c.name] ?? ''} onChange={(e) => setCell(idx, c.name, e.target.value)} />
                  </label>
                ))}
                <button className="button--small" onClick={() => removeRow(idx)}>删除此行</button>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={addRow}>再加一行</button>
              <button onClick={clearAll}>清空</button>
              <button className="nav-button" onClick={execBatchInsert}>插入全部（执行）</button>
            </div>

            <div className="code-block wrap" style={{ marginTop: 8 }}>
              {buildCombinedInsertSQL() || '-- 请在上方输入至少一列的值来生成 INSERT 语句'}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------
// Helpers
// ------------------------------------

function normalizeName(s: string) {
  let out = s.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').slice(0, 64);
  if (!out) return 'my_table';
  if (!/^[A-Za-z_]/.test(out)) out = '_' + out; // avoid starting with digit
  return out;
}

function suggestColName(schema: Schema) {
  return `col_${schema.columns.length + 1}`;
}

function clampInt(v: string | number, min: number, max: number) {
  const n = typeof v === 'number' ? v : parseInt(v || '0', 10);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function renderTypeWithParams(c: Column) {
  switch (c.type) {
    case 'CHAR': return `CHAR(${c.length ?? 1})`;
    case 'VARCHAR': return `VARCHAR(${c.length ?? 1})`;
    case 'DECIMAL': return `DECIMAL(${c.precision ?? 10}, ${c.scale ?? 0})`;
    case 'INT':
    case 'INTEGER':
    case 'REAL':
    case 'TEXT':
    case 'BOOLEAN':
    default:
      return c.type;
  }
}

function generateCreateSQL(schema: Schema) {
  const cols = schema.columns.map(c => {
    const type = renderTypeWithParams(c);
    const pk = c.primary ? ' PRIMARY KEY' : '';
    return `${c.name} ${type}${pk}`;
  }).join(', ');
  return `CREATE TABLE ${schema.tableName} (${cols});`;
}
