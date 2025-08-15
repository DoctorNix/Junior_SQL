import React, { useMemo, useState } from 'react';
import BuildTablePanel from '../components/BuildTablePanel.tsx';
import QueryPanel from '../components/QueryPanel.tsx';
import ResultTable from '../components/ResultTable.tsx';
import DataTable from '../components/DataTable.tsx';
import type { Database, QueryResult, Schema, Column } from '../engine/types.ts';
import { runSQL } from '../engine/sqlEngine.ts';
import { uid } from '../utils/helpers.ts';

// A small default schema for first-time users
const defaultSchema: Schema = {
  tableName: 'people',
  columns: [
    { id: uid(), name: 'id', type: 'INT', primary: true },
    { id: uid(), name: 'name', type: 'VARCHAR', length: 20 },
    { id: uid(), name: 'age', type: 'INT' },
    { id: uid(), name: 'dept_id', type: 'INT' },
  ],
};

export default function PlayLab() {
  // DB state for PlayLab (user can add more tables)
  const [db, setDB] = useState<Database>({
    active: '',
    schemas: {},
    rows: {},
  });

  // Working schema in the builder panel
  const [schema, setSchema] = useState<Schema>(defaultSchema);

  // Last query result
  const [result, setResult] = useState<QueryResult | null>(null);

  // Insert form state for active table
  const activeTable = db.active || Object.keys(db.schemas)[0] || '';
  const activeSchema: Schema | undefined = activeTable ? db.schemas[activeTable] : undefined;
  const [insertVals, setInsertVals] = useState<Record<string, string>>({});

  // Reset form when active table changes
  React.useEffect(() => {
    setInsertVals({});
  }, [activeTable]);

  function literalForSQL(col: Column, raw: string): string {
    const t = col.type;
    if (raw == null || raw.trim() === '') return 'NULL';
    if (t === 'INT' || t === 'INTEGER' || t === 'REAL' || t === 'DECIMAL') {
      // trust sqlEngine to cast; keep input as-is if it looks like number
      return String(raw).trim();
    }
    if (t === 'BOOLEAN') {
      const v = raw.trim().toLowerCase();
      if (v === 'true' || v === '1' || v === 'yes') return 'true';
      if (v === 'false' || v === '0' || v === 'no') return 'false';
      return 'false';
    }
    // TEXT/CHAR/VARCHAR and others -> quoted
    const escaped = String(raw).replace(/'/g, "''");
    return `'${escaped}'`;
  }

  function buildInsertSQL(): string {
    if (!activeSchema) return '';
    const cols = activeSchema.columns.map(c => c.name);
    const vals = activeSchema.columns.map(c => literalForSQL(c, insertVals[c.name] ?? ''));
    return `INSERT INTO ${activeTable} (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
  }

  function setField(col: string, v: string) {
    setInsertVals(prev => ({ ...prev, [col]: v }));
  }

  function execInsert() {
    const sql = buildInsertSQL();
    if (!sql) return;
    try {
      const r = runSQL(sql, db, setDB);
      setResult(r);
    } catch (e: any) {
      setResult({ columns: ['error'], rows: [{ error: e?.message || String(e) }] });
    }
  }

  const hasAnyTable = useMemo(() => Object.keys(db.schemas).length > 0, [db.schemas]);

  const applySchemaToDB = () => {
    const name = schema.tableName;
    setDB(prev => {
      const nextActive = name;
      const nextSchemas = { ...prev.schemas, [name]: JSON.parse(JSON.stringify(schema)) };
      const nextRows = { ...prev.rows, [name]: prev.rows[name] ?? [] };
      return { ...prev, active: nextActive, schemas: nextSchemas, rows: nextRows } as Database;
    });
  };

  return (
    <div>
      {/* Row A: builder + query（等高两列） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
          gap: 12,
          alignItems: 'stretch',
        }}
      >
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <BuildTablePanel
            schema={schema}
            onSchemaChange={setSchema}
            onApply={applySchemaToDB}
            applyLabel="应用到数据库"
            db={db}
            setDB={setDB}
          />
        </section>

        <section className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <QueryPanel
            db={db}
            setDB={setDB}
            onResult={setResult}
            disabled={!hasAnyTable}
            title="模块二：Query 空间"
            schemaPreview={schema}
            autoSyncFromSchema
          />
        </section>
      </div>

      {/* Row C: results + current table（等高两列） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
          gap: 12,
          alignItems: 'stretch',
          marginTop: 12,
        }}
      >
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <ResultTable result={result} title="模块二：执行结果" minHeight={560} />
        </section>

        <section className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>模块三：当前表数据</h2>
            {hasAnyTable && (
              <select
                className="input"
                style={{ padding: '6px 8px', minWidth: 140 }}
                value={db.active || Object.keys(db.schemas)[0] || ''}
                onChange={(e) => setDB(prev => ({ ...prev, active: e.target.value }))}
              >
                {Object.keys(db.schemas).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
          </div>

          {!hasAnyTable ? (
            <div style={{ marginTop: 12 }}>
              <div className="code-block" style={{ background: '#fffaf0' }}>
                还没有任何已创建的表。请在左侧「创造 Table」先设计你的表结构，然后可以点下面按钮把草稿应用为一个空表。
              </div>
              <button style={{ marginTop: 10 }} className="nav-button" onClick={applySchemaToDB}>
                用当前草稿创建空表：{schema.tableName}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 8, width: '100%' }}>
              <DataTable db={db} tableName={db.active || Object.keys(db.schemas)[0]} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
