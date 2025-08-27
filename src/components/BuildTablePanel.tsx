import React from 'react';
import type { Schema, Column, ColType, Database, UniqueSpec, ForeignKeyAction } from '../engine/types';
import { uid } from '../utils/helpers.ts';
import { runSQL } from '../engine/sqlEngine.ts';

function UniqueEditor({ schema, onSchemaChange }: { schema: Schema; onSchemaChange: (s: Schema) => void }) {
  // normalize to array of comma-joined strings for editing
  const uniqueSpecs = (schema.uniqueKeys || []) as any[];
  const uniqueLines = uniqueSpecs.map((u) => Array.isArray(u) ? u.join(', ') : (u?.columns || []).join(', '));
  const [lines, setLines] = React.useState<string[]>(uniqueLines);

  // stable dep signature for changes
  const depSig = (schema.uniqueKeys || [])
    .map((u: any) => Array.isArray(u) ? u.join('|') : (u?.columns || []).join('|'))
    .join(';');
  React.useEffect(() => {
    const fresh = (schema.uniqueKeys || []) as any[];
    setLines(fresh.map((u) => Array.isArray(u) ? u.join(', ') : (u?.columns || []).join(', ')));
  }, [depSig]);

  const add = () => setLines((prev) => [...prev, '']);
  const remove = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));
  const update = (i: number, v: string) => setLines((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  const apply = () => {
    const parsed: UniqueSpec[] = lines
      .map((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
      .filter((arr) => arr.length > 0)
      .map((columns) => ({ columns }));
    onSchemaChange({ ...schema, uniqueKeys: parsed.length ? parsed : undefined });
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>UNIQUE 约束（每行一组列，逗号分隔）</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {lines.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <input className="input" placeholder="col1, col2" value={s} onChange={(e) => update(i, e.target.value)} />
            <button className="button--small" onClick={() => remove(i)}>删除</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button onClick={add}>+ 新增 UNIQUE 组</button>
        <button className="nav-button" onClick={apply}>应用 UNIQUE</button>
      </div>
    </div>
  );
}

function FkEditor({ schema, onSchemaChange }: { schema: Schema; onSchemaChange: (s: Schema) => void }) {
  const fks = schema.foreignKeys || [];
  const [rows, setRows] = React.useState(
    fks.map((f) => ({
      cols: (f.columns || []).join(', '),
      refTable: f.refTable,
      refCols: (f.refColumns || []).join(', '),
      onDelete: (f.onDelete as ForeignKeyAction) || 'RESTRICT',
      onUpdate: (f.onUpdate as ForeignKeyAction) || 'RESTRICT',
    }))
  );

  const fkSig = (schema.foreignKeys || [])
    .map((f) => `${(f.columns || []).join('|')}->${f.refTable}(${(f.refColumns || []).join('|')})/${f.onDelete}/${f.onUpdate}`)
    .join(';');
  React.useEffect(() => {
    setRows(
      (schema.foreignKeys || []).map((f) => ({
        cols: (f.columns || []).join(', '),
        refTable: f.refTable,
        refCols: (f.refColumns || []).join(', '),
        onDelete: (f.onDelete as ForeignKeyAction) || 'RESTRICT',
        onUpdate: (f.onUpdate as ForeignKeyAction) || 'RESTRICT',
      }))
    );
  }, [fkSig]);

  const add = () => setRows((prev) => [...prev, { cols: '', refTable: '', refCols: '', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }]);
  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const setField = (i: number, k: 'cols' | 'refTable' | 'refCols' | 'onDelete' | 'onUpdate', v: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const apply = () => {
    const parsed = rows
      .map((r) => ({
        columns: r.cols.split(',').map((s) => s.trim()).filter(Boolean),
        refTable: r.refTable.trim(),
        refColumns: r.refCols.split(',').map((s) => s.trim()).filter(Boolean),
        onDelete: (r.onDelete as ForeignKeyAction) || 'RESTRICT',
        onUpdate: (r.onUpdate as ForeignKeyAction) || 'RESTRICT',
      }))
      .filter((f) => f.refTable && f.columns.length && f.refColumns.length);
    onSchemaChange({ ...schema, foreignKeys: parsed.length ? parsed : undefined });
  };

  const actions: ForeignKeyAction[] = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>FOREIGN KEY（最简形式）</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gap: 6, gridTemplateColumns: '2fr 1fr 2fr 1fr 1fr auto' }}>
            <input className="input" placeholder="本表列：col1, col2" value={r.cols} onChange={(e) => setField(i, 'cols', e.target.value)} />
            <input className="input" placeholder="引用表" value={r.refTable} onChange={(e) => setField(i, 'refTable', e.target.value)} />
            <input className="input" placeholder="引用列：id 或 id1, id2" value={r.refCols} onChange={(e) => setField(i, 'refCols', e.target.value)} />
            <select className="input" value={r.onDelete} onChange={(e) => setField(i, 'onDelete', e.target.value)}>
              {actions.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
            <select className="input" value={r.onUpdate} onChange={(e) => setField(i, 'onUpdate', e.target.value)}>
              {actions.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
            <button className="button--small" onClick={() => remove(i)}>删除</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button onClick={add}>+ 新增外键</button>
        <button className="nav-button" onClick={apply}>应用外键</button>
      </div>
    </div>
  );
}

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
  /** 可选：把生成的 SQL 交给上层（例如 QueryPanel） */
  onRunSQL?: (sql: string) => void;
};

function togglePrimary(schema: Schema, colName: string, onSchemaChange: (next: Schema) => void) {
  const current = new Set(schema.primaryKey || []);
  if (current.has(colName)) current.delete(colName); else current.add(colName);
  const nextPK = Array.from(current);
  const next: Schema = { ...schema, primaryKey: nextPK.length ? nextPK : undefined };
  // 清除列级 primary 标记（以表级为准）
  next.columns = next.columns.map(c => c.name === colName ? { ...c, primary: false } : c);
  onSchemaChange(next);
}

// ------------------------------------
// Component
// ------------------------------------
export default function BuildTablePanel({ schema, onSchemaChange, onApply, applyLabel = '应用到数据库', disabled, db, setDB, onRunSQL }: BuildTablePanelProps) {
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

  const createSQL = generateCreateSQL(schema);

  // ------------------------------
  // Batch insert (数据录入，合并到创造 Table)
  // ------------------------------
  const [batchRows, setBatchRows] = React.useState<Record<string, string>[]>([{}]);

  const depsVar = `${schema.tableName}|${schema.columns.map(c=>c.id).join(',')}`;

  // when schema changes, keep objects but ensure shape; don't drop user values
  React.useEffect(() => {
    setBatchRows(rows => rows.map(r => ({ ...r })));
  }, [depsVar]);

  function setCell(rowIdx: number, colName: string, v: string) {
    setBatchRows(prev => prev.map((r, i) => (i === rowIdx ? { ...r, [colName]: v } : r)));
  }
  function addRow() { setBatchRows(prev => [...prev, {}]); }
  function removeRow(i: number) { setBatchRows(prev => prev.filter((_, idx) => idx !== i)); }
  function clearAll() { setBatchRows([{}]); }

  // 对外兼容：setField 别名（用于父组件或其他模块调用）
  function setField(rowIdx: number, colName: string, v: string) {
    setCell(rowIdx, colName, v);
  }

  // 仅生成 INSERT SQL，并通过 onRunSQL 发送给外部（例如放入 QueryPanel 文本框）
  function execInsert() {
    const sql = buildCombinedInsertSQL();
    if (!sql) return;
    if (onRunSQL) onRunSQL(sql);
  }

  function literalForSQL(col: Column, raw: string): string {
    const t = col.type;
    if (raw == null || raw.trim() === '') return 'NULL';
    if (t === 'INT' || t === 'INTEGER' || t === 'REAL' || t === 'DECIMAL' || t === 'FLOAT' || t === 'DOUBLE') return String(raw).trim();
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
        <h2 style={{ margin: 0 }}>创建 Table (Create Table)</h2>
        {onApply && (
          <button className="nav-button" onClick={onApply} disabled={disabled}>
            {applyLabel}
          </button>
        )}
      </div>

      {/* DB context quick controls (optional) */}
      {db && setDB && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#64748b' }}>当前目标表：</label>
          <select
            className="input"
            value={db.active || ''}
            onChange={(e) => {
              const name = e.target.value;
              setDB({ ...db, active: name });
            }}
          >
            {Object.keys(db.schemas || {}).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button
            className="button--small"
            onClick={() => {
              const name = db.active;
              if (!name) return;
              const sc = db.schemas[name];
              if (sc) onSchemaChange({ ...sc });
            }}
            disabled={!db.active}
          >
            从数据库载入到编辑器
          </button>
          <button
            className="button--small"
            onClick={() => {
              if (!schema?.tableName) return;
              setDB({ ...db, active: schema.tableName });
            }}
            disabled={!schema?.tableName}
          >
            将当前编辑表设为活动表
          </button>
        </div>
      )}

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
                {['INT','INTEGER','REAL','FLOAT','DOUBLE','DECIMAL','TEXT','CHAR','VARCHAR','BOOLEAN'].map(t => (
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

              {/* PK (table-level, composite allowed) */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={!!(schema.primaryKey || []).includes(c.name)}
                  onChange={() => togglePrimary(schema, c.name, onSchemaChange)}
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

      {/* Table-level constraints */}
      <div style={{ marginTop: 12, borderTop: '1px dashed #e2e8f0', paddingTop: 10 }}>
        <h3 className="section-title" style={{ margin: 0 }}>表级约束（可选）</h3>

        {/* UNIQUE groups (comma-separated columns) */}
        <UniqueEditor schema={schema} onSchemaChange={onSchemaChange} />

        {/* FOREIGN KEY (minimal) */}
        <FkEditor schema={schema} onSchemaChange={onSchemaChange} />
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
              <button onClick={execInsert} disabled={!buildCombinedInsertSQL()}>生成 SQL（发送到查询区）</button>
              <button className="nav-button" onClick={execBatchInsert}>插入全部（执行）</button>
            </div>

            <div className="code-block wrap" style={{ marginTop: 8 }}>
              {buildCombinedInsertSQL() || '-- 请在上方输入至少一列的值来生成 INSERT 语句'}
            </div>
          </div>
        )}
      </div>
      {/* Schema Inspector (optional, read-only) */}
      {db && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>查看现有表（Schema Inspector）</summary>
          <div style={{ marginTop: 8 }}>
            {Object.keys(db.schemas).length === 0 && (
              <div style={{ fontSize: 12, color: '#64748b' }}>数据库当前没有表。</div>
            )}
            {Object.keys(db.schemas).map((t) => {
              const sc = db.schemas[t];
              return (
                <div key={t} style={{ marginBottom: 10, padding: 8, border: '1px solid #e5e7eb', borderRadius: 8 }}>
                  <div style={{ fontWeight: 700 }}>{t}{db.active === t ? '  (active)' : ''}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    列：{sc.columns.map((c) => `${c.name}:${c.type}${c.length ? `(${c.length})` : ''}`).join(', ')}
                  </div>
                  {sc.primaryKey?.length ? (
                    <div style={{ fontSize: 12 }}>PK: ({sc.primaryKey.join(', ')})</div>
                  ) : null}
                  {sc.uniqueKeys?.length ? (
                    <div style={{ fontSize: 12 }}>
                      UNIQUE:
                      {(sc.uniqueKeys as any[]).map((u, i) => {
                        const cols = Array.isArray(u) ? u : (u?.columns || []);
                        return (
                          <span key={i}> ({cols.join(', ')})</span>
                        );
                      })}
                    </div>
                  ) : null}
                  {sc.foreignKeys?.length ? (
                    <div style={{ fontSize: 12 }}>
                      FK:
                      {sc.foreignKeys.map((f, i) => (
                        <div key={i} style={{ marginLeft: 12 }}>
                          ({f.columns.join(', ')}) → {f.refTable}({f.refColumns.join(', ')})
                          {f.onDelete ? ` ON DELETE ${f.onDelete}` : ''}
                          {f.onUpdate ? ` ON UPDATE ${f.onUpdate}` : ''}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </details>
      )}
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
    case 'FLOAT':
    case 'DOUBLE':
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
  const colDefs = schema.columns.map(c => {
    const type = renderTypeWithParams(c);
    // 若使用表级 PK，则不再在列级标 PRIMARY KEY
    const pkCol = (schema.primaryKey || []).includes(c.name) ? '' : (c.primary ? ' PRIMARY KEY' : '');
    return `${c.name} ${type}${pkCol}`;
  });

  const tableClauses: string[] = [];
  if (schema.primaryKey && schema.primaryKey.length) {
    tableClauses.push(`PRIMARY KEY (${schema.primaryKey.join(', ')})`);
  }
  if (schema.uniqueKeys && schema.uniqueKeys.length) {
    for (const uk of schema.uniqueKeys as any[]) {
      const cols = Array.isArray(uk) ? uk : (uk?.columns || []);
      if (cols.length) tableClauses.push(`UNIQUE (${cols.join(', ')})`);
    }
  }
  if (schema.foreignKeys && schema.foreignKeys.length) {
    for (const fk of schema.foreignKeys as any[]) {
      const cols = (fk.columns || fk.cols || []) as string[];
      const refCols = (fk.refColumns || fk.refCols || []) as string[];
      const onDel = fk.onDelete ? ` ON DELETE ${String(fk.onDelete)}` : '';
      const onUpd = fk.onUpdate ? ` ON UPDATE ${String(fk.onUpdate)}` : '';
      if (cols.length && fk.refTable && refCols.length) {
        tableClauses.push(`FOREIGN KEY (${cols.join(', ')}) REFERENCES ${fk.refTable} (${refCols.join(', ')})${onDel}${onUpd}`);
      }
    }
  }

  const all = [...colDefs, ...tableClauses].join(', ');
  return `CREATE TABLE ${schema.tableName} (${all});`;
}
