import React, { useState } from 'react';
import QueryPanel from '../components/QueryPanel.tsx';
import ResultTable from '../components/ResultTable.tsx';
import DataTable from '../components/DataTable.tsx';
import type { Database, QueryResult, Schema } from '../engine/types';

const peopleSchema: Schema = {
  tableName: 'people',
  columns: [
    { id: uid(), name: 'id', type: 'INT' },
    { id: uid(), name: 'name', type: 'VARCHAR', length: 20 },
    { id: uid(), name: 'age', type: 'INT' },
    { id: uid(), name: 'dept_id', type: 'INT' },
    { id: uid(), name: 'salary', type: 'DECIMAL', precision: 10, scale: 2 },
    { id: uid(), name: 'active', type: 'BOOLEAN' },
  ],
  primaryKey: ['id'],
  foreignKeys: [
    { columns: ['dept_id'], refTable: 'dept', refColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }
  ],
};

const deptSchema: Schema = {
  tableName: 'dept',
  columns: [
    { id: uid(), name: 'id', type: 'INT' },
    { id: uid(), name: 'dept_name', type: 'VARCHAR', length: 24 },
  ],
  primaryKey: ['id'],
};

const initialDB: Database = {
  active: 'people',
  schemas: { people: peopleSchema, dept: deptSchema },
  rows: {
    people: [
      { id: 1, name: 'Alice', age: 25, dept_id: 1, salary: 12345.67, active: true },
      { id: 2, name: 'Bob', age: 30, dept_id: 2, salary: 9800.00, active: true },
      { id: 3, name: 'Cathy', age: 22, dept_id: 1, salary: 7000.50, active: false },
      { id: 4, name: 'David', age: 35, dept_id: 3, salary: 15000.00, active: true },
      { id: 5, name: 'Eva', age: 28, dept_id: 2, salary: 11000.00, active: false },
      { id: 6, name: 'Frank', age: 40, dept_id: 4, salary: 17500.25, active: true },
      { id: 7, name: 'Grace', age: 26, dept_id: 1, salary: 9000.75, active: true },
      { id: 8, name: 'Henry', age: 32, dept_id: 5, salary: 13500.00, active: false },
      { id: 9, name: 'Ivy', age: 29, dept_id: 3, salary: 12000.00, active: true },
      { id: 10, name: 'Jack', age: 31, dept_id: 4, salary: 14000.50, active: true },
    ],
    dept: [
      { id: 1, dept_name: 'Engineering' },
      { id: 2, dept_name: 'Marketing' },
      { id: 3, dept_name: 'HR' },
      { id: 4, dept_name: 'Finance' },
      { id: 5, dept_name: 'Sales' },
    ],
  },
};

export default function SampleDB() {
  const [db, setDB] = useState<Database>(initialDB);
  const [result, setResult] = useState<QueryResult | null>(null);

  return (
    <div>
      <div style={{ width: '100%', boxSizing: 'border-box', padding: '0 12px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
            alignItems: 'stretch',
            gap: 12,
            width: '100%',
            boxSizing: 'border-box'
          }}
        >
          <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 560 }}>
            <QueryPanel
              db={db}
              setDB={setDB}
              onResult={setResult}
              title="SampleDB 编辑空间 (Query Panel)"
              schemaPreview={db.schemas[db.active]}
              autoSyncFromSchema
              defaultSQL={
                `-- 示例：按部门编号统计人数与平均年龄（无 JOIN 版）\n` +
                `SELECT dept_id AS dept, COUNT(*) AS cnt, AVG(age) AS avg_age\n` +
                `FROM people\n` +
                `GROUP BY dept_id\n` +
                `ORDER BY cnt DESC;`
              }
            />
          </div>
          <div className="panel" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 560 }}>
            <ResultTable result={result} minHeight={560} minRows={10} rowHeight={32} />
          </div>
        </div>

      <div style={{ marginTop: 12 }}>
        <h3 style={{ margin: '8px 0' }}>浏览 people / dept</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
          <div className="panel" style={{ margin: 0 }}>
            <h4 style={{ marginTop: 0 }}>people</h4>
            <div style={{ width: '100%' }}>
              <DataTable db={db} tableName="people" compact maxRows={db.rows.people.length} />
            </div>
          </div>
          <div className="panel" style={{ margin: 0 }}>
            <h4 style={{ marginTop: 0 }}>dept</h4>
            <div style={{ width: '100%' }}>
              <DataTable db={db} tableName="dept" compact maxRows={db.rows.dept.length} />
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

function uid() { return Math.random().toString(36).slice(2, 9); }
