import React, { useMemo, useState } from 'react';
import InsertData from '../components/InsertData.tsx';
import DataExport from '../components/DataExport.tsx';
import QueryPanel from '../components/QueryPanel.tsx';
import ResultTable from '../components/ResultTable.tsx';
import DataTable from '../components/DataTable.tsx';
import type { Database, Schema, QueryResult } from '../engine/types.ts';
import { uid } from '../utils/helpers.ts';

// Default lightweight schema so users can import quickly
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

export default function DataIO() {
  // Local DB state for the Data I/O page
  const [db, setDB] = useState<Database>({ active: '', schemas: {}, rows: {} });
  const [schema] = useState<Schema>(defaultSchema);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [injectedSQL, setInjectedSQL] = useState<string | undefined>(undefined);

  const hasAnyTable = useMemo(() => Object.keys(db.schemas).length > 0, [db.schemas]);
  const activeTable = db.active || Object.keys(db.schemas)[0] || '';

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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
        // 两行：上（模块一），下（模块三）；右侧模块二跨两行 → 高度自然等于两行总和（含 gap）
        gridTemplateRows: 'auto auto',
        gap: 12,
        alignItems: 'stretch',
      }}
    >
      {/* 模块一：导入 + 导出（左上） */}
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 190 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 className="panel-title" style={{ margin: 0, fontSize: 18 }}>
            数据导入 / 导出（Data Import / Export）
          </h2>
          {/* 可选：一键应用默认空表
          {!hasAnyTable && (
            <button className="nav-button" onClick={applySchemaToDB}>
              使用默认表（创建空表：{schema.tableName}）
            </button>
          )} */}
        </div>

        <div style={{ marginTop: 8 }}>
          <InsertData schema={schema} onRunSQL={(sql) => setInjectedSQL(sql)} />
        </div>

        {/* 导出（与导入同模块） */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 className="section-title" style={{ margin: 0 }}>导出 CSV / Excel</h3>
            {hasAnyTable && (
              <select
                className="input"
                style={{ padding: '6px 8px', minWidth: 180 }}
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
            <div className="code-block" style={{ background: '#fffaf0', marginTop: 8, fontSize: 14 }}>
              暂无可导出的表。请先在上方导入数据。
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <DataExport data={db.rows[activeTable] || []} filename={activeTable || 'export'} />
              <div style={{ marginTop: 8, color: '#64748b', fontSize: 14 }}>
                提示：导出会包含当前表所有行（若无数据会导出空表头或空文件）。
              </div>
            </div>
          )}
        </div>

        {hasAnyTable && (
          <div style={{ marginTop: 10 }}>
            <h3 className="section-title" style={{ margin: 0 }}>导入成功标记（当前表前 10 行预览）</h3>
            <div style={{ marginTop: 6 }}>
              <DataTable db={db} tableName={activeTable} maxRows={10} />
            </div>
          </div>
        )}
      </section>

      {/* 模块二：结果显示（右列，跨两行，高度随左侧两块的总高度自适应） */}
      <section
        className="panel"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          gridColumn: '2 / 3',
          gridRow: '1 / span 2',
        }}
      >
        {/* 不设置 minHeight；随网格高度自然拉伸 */}
        <ResultTable result={result} minRows={10} rowHeight={32} />
      </section>

      {/* 模块三：Query Panel（左下） */}
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 380 }}>
        <QueryPanel
          key={`dio-q-${(injectedSQL || '').length}-${db.active}`}
          db={db}
          setDB={setDB}
          onResult={setResult}
          disabled={!hasAnyTable}
          title="查询空间（Query Panel）"
          schemaPreview={schema}
          autoSyncFromSchema
          defaultSQL={injectedSQL}
          examplesReadOnly
        />
      </section>
    </div>
  );
}
