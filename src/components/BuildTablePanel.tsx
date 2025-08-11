import React from 'react';
import type { Schema, Column, ColType } from '../engine/types.ts';

// ------------------------------------
// Props
// ------------------------------------
export type BuildTablePanelProps = {
  schema: Schema;
  onSchemaChange: (next: Schema) => void;
  onApply?: () => void; // optional: apply to DB
  applyLabel?: string;
  disabled?: boolean;
};

// ------------------------------------
// Component
// ------------------------------------
export default function BuildTablePanel({ schema, onSchemaChange, onApply, applyLabel = '应用到数据库', disabled }: BuildTablePanelProps) {
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
                  updateColumn(c.id, base);
                }}
                className="input"
              >
                {['INT','REAL','DECIMAL','TEXT','CHAR','VARCHAR','BOOLEAN'].map(t => (
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
                    onChange={(e) => updateColumn(c.id, { precision: clampInt(e.target.value, 1, 38) })}
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
    </section>
  );
}

// ------------------------------------
// Helpers
// ------------------------------------
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function normalizeName(s: string) {
  return s.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').slice(0, 64) || 'my_table';
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