import React, { useMemo, useState } from 'react';
import BuildTablePanel from '../components/BuildTablePanel.tsx';
import QueryPanel from '../components/QueryPanel.tsx';
import ResultTable from '../components/ResultTable.tsx';
import DataTable from '../components/DataTable.tsx';
import type { Database, QueryResult, Schema } from '../engine/types.ts';

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
    active: defaultSchema.tableName,
    schemas: { [defaultSchema.tableName]: defaultSchema },
    rows: {
      [defaultSchema.tableName]: [
        { id: 1, name: 'Alice', age: 25, dept_id: 1 },
        { id: 2, name: 'Bob', age: 30, dept_id: 2 },
      ],
    },
  });

  // Working schema in the builder panel
  const [schema, setSchema] = useState<Schema>(defaultSchema);

  // Last query result
  const [result, setResult] = useState<QueryResult | null>(null);

  const hasAnyTable = useMemo(() => Object.keys(db.schemas).length > 0, [db.schemas]);

  const applySchemaToDB = () => {
    const name = schema.tableName;
    setDB(prev => {
      const next: Database = {
        active: name,
        schemas: { ...prev.schemas, [name]: JSON.parse(JSON.stringify(schema)) },
        rows: { ...prev.rows, [name]: prev.rows[name] ?? [] },
      };
      return next;
    });
  };

  return (
    <div>
      {/* Row: builder + query */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <BuildTablePanel
          schema={schema}
          onSchemaChange={setSchema}
          onApply={applySchemaToDB}
          applyLabel="应用到数据库"
        />

        <QueryPanel
          db={db}
          setDB={setDB}
          onResult={setResult}
          disabled={!hasAnyTable}
          title="模块二：Query 空间"
        />
      </div>

      {/* Row: results + current table preview */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12, marginTop: 12 }}>
        <ResultTable result={result} />

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>模块三：当前表数据</h2>
            <select
              className="input"
              value={db.active}
              onChange={(e) => setDB(prev => ({ ...prev, active: e.target.value }))}
            >
              {Object.keys(db.schemas).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 8 }}>
            <DataTable db={db} tableName={db.active} />
          </div>
        </section>
      </div>
    </div>
  );
}

function uid() { return Math.random().toString(36).slice(2, 9); }
