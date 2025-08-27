import React, { useMemo, useState } from 'react';
import BuildTablePanel from '../components/BuildTablePanel.tsx';
import QueryPanel from '../components/QueryPanel.tsx';
import ResultTable from '../components/ResultTable.tsx';
import DataTable from '../components/DataTable.tsx';
// import InsertData from '../components/InsertData.tsx';
// import DataExport from '../components/DataExport.tsx';
import type { Database, QueryResult, Schema, Column } from '../engine/types.ts';
import { runSQL } from '../engine/sqlEngine.ts';
import { uid } from '../utils/helpers.ts';

// A small default schema for first-time users
const defaultSchema: Schema = {
  tableName: 'people',
  columns: [
    { id: uid(), name: 'id', type: 'INT' },
    { id: uid(), name: 'name', type: 'VARCHAR', length: 20 },
    { id: uid(), name: 'age', type: 'INT' },
    { id: uid(), name: 'dept_id', type: 'INT' },
  ],
  primaryKey: ['id'],
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

  // Inject SQL into QueryPanel (force remount with key to apply defaultSQL)
  const [injectedSQL, setInjectedSQL] = useState<string | undefined>(undefined);

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
    if (t === 'INT' || t === 'INTEGER' || t === 'REAL' || t === 'DECIMAL' || t === 'FLOAT' || t === 'DOUBLE') {
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
    setInjectedSQL(undefined);
  };

  return (
    <div>
      {/* Quick Start / 使用说明 */}
      <section className="panel" style={{ marginBottom: 12 }}>
        <h2 className="panel-title" style={{ marginTop: 0 }}>使用说明（PlayLab）</h2>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <strong>1：创造 Table（左上）</strong> – 在左侧编辑表名/列并点击「应用到数据库」。
              创建成功后，该表将成为当前 <em>活动表</em>（Active）。
            </li>
            <li>
              <strong>2：当前表数据（右上）</strong> – 通过右上角下拉切换活动表，实时查看该表的行数据。
            </li>
            <li>
              <strong>3：Query 空间（左下）</strong> – 编写/粘贴 SQL 并点击「▶ 运行」。
              支持 <code>CREATE</code> / <code>INSERT</code> / <code>SELECT</code> / <code>UPDATE</code> / <code>DELETE</code> / <code>DROP TABLE IF EXISTS</code> / <code>CREATE VIEW</code> 等子集。
              <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
                快捷键：<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> 运行；支持注释 <code>--</code>、<code>//</code>、<code>#</code> 与块注释 <code>/* ... */</code>。
              </div>
            </li>
            <li>
              <strong>模块四：结果显示（右下）</strong> – 展示上一次查询/变更的结果。默认显示最多 10 行（可在表格内滚动查看更多）。
            </li>
          </ol>
          <div className="code-block" style={{ marginTop: 8 }}>
            示例：
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{`-- 新建 people 表（若已存在则跳过）\nCREATE TABLE IF NOT EXISTS people (\n  id INT PRIMARY KEY,\n  name VARCHAR(20),\n  age INT,\n  dept_id INT\n);\n\n-- 插入两行\nINSERT INTO people (id, name, age, dept_id) VALUES (1, 'Alice', 25, 1), (2, 'Bob', 30, 2);\n\n-- 查询与分组\nSELECT dept_id AS dept, COUNT(*) AS cnt, AVG(age) AS avg_age\nFROM people\nGROUP BY dept_id\nORDER BY cnt DESC;`}</pre>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            小提示：创建多张表后，可在「当前表数据」右上角切换活动表；在「创造 Table」中也可点击“将当前编辑表设为活动表”。
          </div>
        </div>
      </section>
      {/* Row A: builder + current table（等高两列） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
          gap: 12,
          alignItems: 'stretch',
        }}
      >
        {/* Left: Build table & batch add (internal) */}
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, maxWidth: '95%' }}>
          <BuildTablePanel
            schema={schema}
            onSchemaChange={setSchema}
            onApply={applySchemaToDB}
            applyLabel="应用到数据库"
            db={db}
            setDB={setDB}
            onRunSQL={(sql) => setInjectedSQL(sql)}
          />
        </section>

        {/* Right: Current table preview */}
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, maxWidth: '95%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 className="panel-title" style={{ margin: 0 }}>当前表数据 (Current Table Data)</h2>
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

      {/* Row B: query + results（等高两列） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
          gap: 12,
          alignItems: 'stretch',
          marginTop: 12,
        }}
      >
        {/* Left: Query */}
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, maxWidth: '95%' }}>
          <QueryPanel
            key={`qp-${(injectedSQL || '').length}-${db.active}`}
            db={db}
            setDB={setDB}
            onResult={setResult}
            disabled={!hasAnyTable}
            title="Query 空间 (Query Panel)"
            schemaPreview={schema}
            autoSyncFromSchema
            defaultSQL={injectedSQL}
          />
        </section>

        {/* Right: Result */}
        <section className="panel" style={{ display: 'flex', width: '100%', flexDirection: 'column', height: '100%', minHeight: 420, maxWidth: '95%' }}>
          <ResultTable result={result} minHeight={560} minRows={10} rowHeight={32} />
        </section>
      </div>
    </div>
  );
}
