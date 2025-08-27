import React, { useMemo, useState, useCallback, useEffect } from 'react';
import type { Database, QueryResult, Column, Schema } from '../engine/types.ts';
import { runSQL } from '../engine/sqlEngine.ts';

/**
 * QueryPanel
/**
 * Strip SQL comments: removes --, //, # line comments and /* block comments *\/
 */
function stripComments(sql: string): string {
  if (!sql) return '';
  // Remove block comments first: /* ... */
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments: --, //, #
  s = s.replace(/--.*$/gm, '');
  s = s.replace(/\/\/.*$/gm, '');
  s = s.replace(/#.*$/gm, '');
  return s;
}

/**
 * 
 * Usage modes:
 *  - PlayLab: interactive examples (default). Provide schemaPreview & autoSyncFromSchema as needed.
 *  - DataIO: set `examplesReadOnly` so example buttons act as docs only (no one-click injection).
 *
 * Props behavior:
 *  - `defaultSQL` is applied on mount and whenever it changes (so parent key-for-remount is optional).
 *  - `autoSyncFromSchema` will render `SELECT col1, ... FROM <table>;` when schemaPreview changes.
 */

export type QueryPanelProps = {
  db: Database;
  setDB: (next: Database) => void;
  onResult: (r: QueryResult) => void;
  title?: string;
  disabled?: boolean;
  defaultSQL?: string;
  showExamples?: boolean;
  schemaPreview?: Schema;
  autoSyncFromSchema?: boolean;
  examplesReadOnly?: boolean;
};


// NOTE: This component does not read React's special `key` prop. Parent may use a changing `key` to force remount
// (e.g., when injecting new defaultSQL). We also sync on `defaultSQL` changes to make remount optional.
const QueryPanel: React.FC<QueryPanelProps> = ({
  db,
  setDB,
  onResult,
  title = 'Query 空间 (Query Panel)',
  disabled,
  defaultSQL,
  showExamples = true,
  schemaPreview,
  autoSyncFromSchema,
  examplesReadOnly,
}) => {
  const active = db.active;
  const hintedTable = schemaPreview?.tableName || active;
  const initialSQL = (defaultSQL && defaultSQL.trim().length)
    ? defaultSQL
    : (hintedTable ? `SELECT * FROM ${hintedTable};` : 'SELECT 1;');
  const [sql, setSql] = useState<string>(initialSQL);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedExample, setSelectedExample] = useState<{ name: string; sql: string; hint?: string; how?: string; usage?: string; worksOn?: string } | null>(null);
  const [lastRunSQL, setLastRunSQL] = useState<string>('');
  const [lastRunResult, setLastRunResult] = useState<QueryResult | null>(null);
  const [effectText, setEffectText] = useState<string | null>(null);

  const tableName = useMemo(() => schemaPreview?.tableName || active, [schemaPreview, active]);
  const previewSig = useMemo(() => {
    if (!schemaPreview) return '';
    return (schemaPreview.columns || [])
      .map(c => `${c.name}:${c.type}:${c.length ?? ''}:${c.precision ?? ''}:${c.scale ?? ''}`)
      .join('|');
  }, [schemaPreview]);

  useEffect(() => {
    if (defaultSQL) return;
    const fallback = tableName ? `SELECT * FROM ${tableName};` : 'SELECT 1;';
    setSql(prev => (prev?.trim().length ? prev : fallback));
  }, [defaultSQL, tableName]);

  // If parent provides a new defaultSQL (e.g., injected multi-row INSERT), apply it once
  useEffect(() => {
    if (defaultSQL && defaultSQL.trim().length) {
      setSql(defaultSQL);
    }
  }, [defaultSQL]);

  const syncKey = `${autoSyncFromSchema ? '1' : '0'}|${tableName}|${previewSig}`;
  // Auto-sync query text from builder schema: SELECT col1, col2 FROM table;
  useEffect(() => {
    if (!autoSyncFromSchema || !schemaPreview) return;
    const cols = (schemaPreview.columns || []).map(c => c.name).filter(Boolean);
    const list = cols.length ? cols.join(', ') : '*';
    setSql(`SELECT ${list} FROM ${tableName};`);
  }, [syncKey]);

  const examples = useMemo(() => makeExamples(db, schemaPreview?.tableName || active, schemaPreview), [db, active, schemaPreview]);

  function validateSQLText(s: string): string | null {
    const textRaw = (s || '').trim();
    const text = stripComments(textRaw).trim();
    if (!text) return '请输入一条 SQL 语句。';

    // Only allow the subsets we support
    const head = text.replace(/^\(|^\s+/, '').slice(0, 12).toUpperCase();
    const allowed = /^(CREATE|INSERT|SELECT|UPDATE|DELETE)/.test(head);
    if (!allowed) return '仅支持: CREATE / INSERT / SELECT / UPDATE / DELETE。';

    // For SELECT, require FROM unless selecting constants (e.g., SELECT 1; SELECT 'a', 2;)
    if (/^SELECT\b/i.test(text)) {
      const hasFrom = /\bFROM\b/i.test(text);
      const constOnly = /^SELECT\s+(?:\d+|TRUE|FALSE|'[^']*')(?:\s*,\s*(?:\d+|TRUE|FALSE|'[^']*'))*\s*;?$/i.test(text);
      if (!hasFrom && !constOnly) {
        return 'SELECT 需要 FROM 子句（例如：SELECT * FROM people;）。如需测试常量可用：SELECT 1;';
      }
    }
    return null;
  }

  const onRun = useCallback(() => {
    if (disabled) return;
    const verr = validateSQLText(sql);
    if (verr) {
      setError(verr);
      onResult({ columns: ['error'], rows: [{ error: verr }] });
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const sqlToRun = stripComments(sql);
      const result = runSQL(sqlToRun, db, setDB);
      onResult(result);
      setLastRunSQL(sqlToRun);
      setLastRunResult(result);
      setEffectText(describeEffect(sqlToRun, result, db));
    } catch (e: any) {
      const msg = e?.message || String(e);
      setError(msg);
      onResult({ columns: ['error'], rows: [{ error: msg }] });
      setLastRunSQL(sql);
      setLastRunResult(null);
      setEffectText(null);
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
    <section className="query-panel" aria-label="Query" style={{ fontSize: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="nav-button"
            onClick={onRun}
            disabled={disabled || running}
            title={disabled ? '请先创建/应用一个表后再运行查询。' : '运行当前 SQL（Ctrl/⌘+Enter）'}
          >
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
        style={{ width: '100%', height: 180, borderRadius: 12, marginTop: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 14 }}
        placeholder={tableName ? `SELECT * FROM ${tableName};` : 'SELECT 1;'}
      />

      {/* Inline helper when editing an INSERT statement */}
      {/^\s*INSERT\b/i.test(sql) && (
        <div className="code-block" style={{ marginTop: 8, background: '#f0f9ff', color: '#0f172a' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>INSERT 提示：</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>未在列清单中出现的列，若存在 <code>DEFAULT</code> 值将自动填充，否则为 <code>NULL</code>。</li>
            <li>类型转换：<code>INT/REAL/DECIMAL/BOOLEAN</code> 会按目标列类型转换；文本请用单引号包裹并转义单引号（<code>''</code>）。</li>
            <li>约束检查：包含 <strong>主键唯一性</strong>、<strong>UNIQUE</strong>、<strong>外键存在</strong>、以及（若设置）<strong>NOT NULL/CHECK</strong>。</li>
            <li>批量插入：可写成 <code>VALUES (...), (...), ...</code> 一次插入多行。</li>
            <li>大量导入：可在 PlayLab 的“导入数据（CSV/Excel）”模块生成多行 <code>INSERT</code> 并发送到这里。</li>
          </ul>
        </div>
      )}

      {showExamples && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {examples.map((ex) => (
            <button
              key={ex.name}  // 保留原key，基于示例名称确保唯一性
              className={`nav-button ${examplesReadOnly ? 'nav-button--readonly' : ''}`}
              onClick={() => { 
                setSelectedExample(ex);
                if (!examplesReadOnly) {
                  setSql(ex.sql);
                }
              }}
              disabled={disabled} // 仅在整体禁用时不可点击，只读模式仍可点击查看详情
              title={examplesReadOnly 
                ? '点击查看示例说明（本模式不支持一键注入）' 
                : (ex.hint || ex.how)
              }
            >
              {ex.name}
            </button>
          ))}
          {/* 只读模式提示信息（移动到按钮下方） */}
          {examplesReadOnly && (
            <div style={{ 
              marginTop: 6, 
              padding: '4px 8px',
              borderRadius: 4,
              background: '#f8fafc',
              color: '#64748b', 
              fontSize: 12,
              width: '100%' // 占满整行
            }}>
              示例仅作语法参考，您可以：
              <ul style={{ margin: '4px 0 0', paddingLeft: 16, lineHeight: 1.4 }}>
                <li>点击示例名称查看详细说明</li>
                <li>手动复制示例SQL到编辑器中修改运行</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {selectedExample && (
        <div className="code-block" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Example：{selectedExample.name}</strong>
            <button className="button--small" onClick={() => setSelectedExample(null)}>关闭</button>
          </div>
          <div style={{ marginTop: 6 }}><strong>名称：</strong>{selectedExample.name}</div>
          {selectedExample.usage && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600 }}>Usage：</div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{selectedExample.usage}</pre>
            </div>
          )}
          {selectedExample.how || selectedExample.hint ? (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600 }}>How it works：</div>
              <div>{selectedExample.how || selectedExample.hint}</div>
            </div>
          ) : null}
          {selectedExample.worksOn && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600 }}>Works on：</div>
              <div>{selectedExample.worksOn}</div>
            </div>
          )}
          {/* Dynamic effect based on last run */}
          {selectedExample && effectText ? (
            normalizeSQL(selectedExample.sql) === normalizeSQL(lastRunSQL) ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 600 }}>Effect（based on last run）：</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{effectText}</pre>
              </div>
            ) : (
              <div style={{ marginTop: 8, color: '#64748b' }}>运行此示例以查看针对当前数据的效果总结。</div>
            )
          ) : null}
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
};

export default QueryPanel;

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

  const list: { name: string; sql: string; hint?: string; usage?: string; how?: string; worksOn?: string }[] = [];

  // 基础
  list.push({ name: '查全部 Select All', sql: `SELECT * FROM ${table};`, usage: `SELECT * FROM ${table};`, how: '返回整张表的所有列与行。', worksOn: `${table}` });
  list.push({ name: '挑字段 Select Specific', sql: `SELECT ${[cName, c2].filter(Boolean).join(', ')} FROM ${table};`, usage: `SELECT ${[cName, c2].filter(Boolean).join(', ')} FROM ${table};`, how: '只返回所选的列，减少无关数据。', worksOn: `${table} 的列：${[cName, c2].filter(Boolean).join(', ')}` });
  list.push({ name: '条件 AND/OR', sql: `SELECT * FROM ${table} WHERE ${cName} = ${mockLiteral(cols[0]) || 1} OR ${c2} LIKE '%a%';`, hint: '支持 AND / OR / 括号 / LIKE / 比较', usage: `SELECT * FROM ${table} WHERE ${cName} = ... OR ${c2} LIKE '%a%';`, how: '通过逻辑运算组合多个条件，LIKE 支持模糊匹配（%表示任意多字符）。', worksOn: `${table} 上的列 ${cName} 与 ${c2}` });
  list.push({ name: '排序多列', sql: `SELECT * FROM ${table} ORDER BY ${numCol} DESC, ${cName} ASC;`, usage: `SELECT * FROM ${table} ORDER BY ${numCol} DESC, ${cName} ASC;`, how: '先按数值列降序，再按主键或第一列升序。', worksOn: `${table} 的 ${numCol}, ${cName}` });

  // DISTINCT
  list.push({ name: 'DISTINCT', sql: `SELECT DISTINCT ${c2} FROM ${table} ORDER BY ${c2};`, hint: '去重后再排序', usage: `SELECT DISTINCT ${c2} FROM ${table} ORDER BY ${c2};`, how: '对目标列做去重，去重后再排序。', worksOn: `${table} 的列：${c2}` });

  // GROUP BY：选择一个非空列分组 + 可选聚合
  list.push({
    name: 'GROUP BY',
    sql: `SELECT ${c2} AS k, COUNT(*) AS cnt${numCol ? `, AVG(${numCol}) AS avg_v` : ''} FROM ${table} GROUP BY ${c2} ORDER BY cnt DESC;`,
    usage: `SELECT ${c2} AS k, COUNT(*) AS cnt${numCol ? `, AVG(${numCol}) AS avg_v` : ''} FROM ${table} GROUP BY ${c2};`,
    how: '按某列分组并计算聚合，如计数和平均值。',
    worksOn: `${table} 的分组列 ${c2}${numCol ? ` 与数值列 ${numCol}` : ''}`
  });

  // COUNT(*)
  list.push({ name: 'COUNT(*)', sql: `SELECT COUNT(*) AS total FROM ${table};`, hint: '统计总行数', usage: `SELECT COUNT(*) AS total FROM ${table};`, how: '计算表中总记录数。', worksOn: `${table}` });

  // HAVING（基于别名条件）
  if (c2) {
    list.push({
      name: 'HAVING(别名)',
      sql: `SELECT ${c2} AS k, COUNT(*) AS cnt FROM ${table} GROUP BY ${c2} HAVING cnt > 1 ORDER BY cnt DESC;`,
      hint: '使用 SELECT 中的别名在 HAVING 里做过滤',
      usage: `... GROUP BY ${c2} HAVING cnt > 1;`,
      how: '在分组完成后再过滤分组结果；这里使用 SELECT 里定义的别名 cnt。',
      worksOn: `${table} 的分组列 ${c2}`
    });
  }

  // 取样当前表的值用于 IN/BETWEEN 示例
  const rows: any[] = ((db.rows as any)[table] as any[]) || [];
  const pickVals = sampleValues(rows, c2, 2);
  const pickNums = numCol ? sampleValues(rows, numCol, 2).map(Number).filter(n => !Number.isNaN(n)) : [];

  // IN / NOT IN（优先使用真实值样本）
  if (c2) {
    const inList = (pickVals.length ? pickVals : [mockLiteral(cols[1] || cols[0], 1), mockLiteral(cols[1] || cols[0], 2)])
      .map(v => (typeof v === 'string' && !/^'.*'$/.test(v) ? `'${v}'` : String(v)))
      .join(', ');
    list.push({ name: 'IN', sql: `SELECT * FROM ${table} WHERE ${c2} IN (${inList});`, usage: `SELECT * FROM ${table} WHERE ${c2} IN ( ... );`, how: '只保留列值属于候选列表的一些行。', worksOn: `${table} 的列 ${c2}` });
    list.push({ name: 'NOT IN', sql: `SELECT * FROM ${table} WHERE ${c2} NOT IN (${inList});`, usage: `SELECT * FROM ${table} WHERE ${c2} NOT IN ( ... );`, how: '排除列值属于候选列表的行。', worksOn: `${table} 的列 ${c2}` });
  }

  // BETWEEN（数值列优先，找两端范围）
  if (numCol) {
    const a = pickNums[0] ?? 10;
    const b = pickNums[1] ?? 50;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    list.push({ name: 'BETWEEN', sql: `SELECT * FROM ${table} WHERE ${numCol} BETWEEN ${lo} AND ${hi};`, usage: `SELECT * FROM ${table} WHERE ${numCol} BETWEEN ${lo} AND ${hi};`, how: '筛选处于闭区间 [lo, hi] 的数值。', worksOn: `${table} 的数值列：${numCol}` });
  }

  // IS NULL / IS NOT NULL（演示语法，即使当前数据无空也可执行）
  list.push({ name: 'IS NULL', sql: `SELECT * FROM ${table} WHERE ${c2} IS NULL;`, usage: `... WHERE ${c2} IS NULL;`, how: '保留列值为空（NULL）的行。', worksOn: `${table} 的列 ${c2}` });
  list.push({ name: 'IS NOT NULL', sql: `SELECT * FROM ${table} WHERE ${c2} IS NOT NULL;`, usage: `... WHERE ${c2} IS NOT NULL;`, how: '保留列值不为空的行。', worksOn: `${table} 的列 ${c2}` });

  // LIMIT 扩展
  list.push({ name: 'LIMIT OFFSET', sql: `SELECT * FROM ${table} ORDER BY ${cName} LIMIT 3 OFFSET 2;`, hint: '跳过2条，取3条', usage: `SELECT * FROM ${table} ORDER BY ${cName} LIMIT 3 OFFSET 2;`, how: '先排序，再跳过 2 条，取 3 条。', worksOn: `${table}（按 ${cName} 排序）` });
  list.push({ name: 'LIMIT m,n', sql: `SELECT * FROM ${table} ORDER BY ${cName} LIMIT 2, 3;`, hint: '从第3条开始取3条（MySQL风格）', usage: `SELECT * FROM ${table} ORDER BY ${cName} LIMIT 2, 3;`, how: 'MySQL 风格：LIMIT offset, count。', worksOn: `${table}（按 ${cName} 排序）` });

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

  // INSERT：一次插入多行（VALUES 列表）
  if (cols.length) {
    const colList = cols.map(c => c.name).join(', ');
    const v1 = cols.map((c, i) => mockLiteral(c, i)).join(', ');
    const v2 = cols.map((c, i) => mockLiteral(c, i! + 10)).join(', ');
    list.push({
      name: '插入多行',
      sql: `INSERT INTO ${table} (${colList}) VALUES (${v1}), (${v2});`,
      hint: 'VALUES (...), (...) 一次性插入多行'
    });
  }

  // DELETE：删除一行（按首列/主键示例）
  if (cols.length) {
    const pk = cols[0]?.name || 'id';
    const rowsAny: any[] = ((db.rows as any)[table] as any[]) || [];
    const sampleId = (rowsAny[0]?.[pk] ?? 1);
    list.push({
      name: '删除一行',
      sql: `DELETE FROM ${table} WHERE ${pk} = ${typeof sampleId === 'string' ? `'${sampleId}'` : sampleId};`,
      how: '通过 WHERE 精确定位待删除的行，只删除匹配条件的记录。'
    });

    // 多条件删除示例
    const secondCol = cols[1]?.name || pk;
    if (secondCol && secondCol !== pk) {
      list.push({
        name: '条件删除（AND）',
        sql: `DELETE FROM ${table} WHERE ${pk} > 0 AND ${secondCol} IS NOT NULL;`,
        how: '结合多个条件删除一批记录，务必先用 SELECT 验证命中范围。'
      });
    }

    // 危险操作：全表删除（示例用途，谨慎）
    list.push({
      name: '清空表（谨慎）',
      sql: `DELETE FROM ${table};`,
      hint: '删除整张表中的所有记录，请先备份或使用示例库中操作',
      how: '无 WHERE 条件将删除整表数据。教学场景下可在示例库中尝试。',
      worksOn: `${table}`
    });
  }

  // DROP TABLE IF EXISTS（教学演示）
  list.push({
    name: '删除表（IF EXISTS）',
    sql: `DROP TABLE IF EXISTS ${table};`,
    how: '若表存在则删除；若不存在则跳过不报错。注意：若被外键引用将拒绝删除。',
    worksOn: `${table}`
  });

  // CREATE VIEW（基于当前表的简单视图）
  if (cols.length) {
    const viewName = `${table}_view1`;
    const pick = cols.slice(0, Math.min(2, cols.length)).map(c => c.name).join(', ');
    list.push({
      name: '创建视图',
      sql: `CREATE VIEW ${viewName} AS SELECT ${pick || '*'} FROM ${table};`,
      how: '创建只读视图，后续可直接 SELECT * FROM 视图名；适合保存常用查询。',
      worksOn: `${viewName}`
    });

    list.push({
      name: '查询视图',
      sql: `SELECT * FROM ${viewName};`,
      how: '使用已创建的视图进行查询。',
      worksOn: `${viewName}`
    });
  }

  return list;
}

function isNumericCol(c: Column) {
  return c.type === 'INT' || c.type === 'INTEGER' || c.type === 'REAL' || c.type === 'DECIMAL' || c.type === 'FLOAT' || c.type === 'DOUBLE';
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
    case 'FLOAT':
    case 'DOUBLE':
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

function normalizeSQL(s: string) {
  const noComments = stripComments(s || '');
  return noComments.replace(/\s+/g, ' ').trim().toUpperCase();
}

function extractFromTable(s: string): string | null {
  const m = s.match(/\bFROM\s+([A-Za-z_][\w]*)/i);
  return m ? m[1] : null;
}

function describeEffect(sql: string, res: QueryResult, db: Database): string | null {
  if (!res) return null;
  const text = (sql || '').trim();
  if (!text) return null;
  const up = text.toUpperCase();

  // DML messages (INSERT/UPDATE/DELETE)
  if (/^(INSERT|UPDATE|DELETE)\b/.test(up)) {
    const row0: any = res.rows && res.rows[0] ? res.rows[0] : {};
    const affected = row0.affected ?? row0.AFFECTED;
    const message = row0.message || row0.MESSAGE || '';
    if (typeof affected === 'number') {
      return `影响行数：${affected}${message ? `\n${message}` : ''}`;
    }
    return message || '语句已执行。';
  }

  // SELECT effects
  if (/^SELECT\b/.test(up)) {
    const table = extractFromTable(text);
    const total = table && (db.rows as any)[table] ? ((db.rows as any)[table] as any[]).length : undefined;
    const lines: string[] = [];
    const n = res.rows ? res.rows.length : 0;
    lines.push(`返回行数：${n}${typeof total === 'number' ? ` / 总计 ${total}` : ''}`);

    if (/\bWHERE\b/i.test(text)) lines.push('已应用筛选（WHERE）。');
    if (/\bGROUP\s+BY\b/i.test(text)) {
      lines.push(`分组数：${n}`);
      const kCol = (res.columns || []).find(c => c === 'k' || /name|dept|group|key/i.test(c));
      const cntCol = (res.columns || []).find(c => c === 'cnt' || /^count/i.test(c));
      if (kCol && cntCol && res.rows && res.rows.length) {
        const top = res.rows[0] as any;
        if (top && top[cntCol] != null) {
          lines.push(`示例最大组：${top[kCol]}（${String(cntCol)}=${top[cntCol]}）`);
        }
      }
    }
    if (/\bORDER\s+BY\b/i.test(text)) lines.push('已排序（ORDER BY）。');

    const m1 = text.match(/\bLIMIT\s+(\d+)(?:\s*,\s*(\d+))?/i);
    if (m1) {
      const a = Number(m1[1]);
      const b = m1[2] != null ? Number(m1[2]) : null;
      if (b != null) {
        lines.push(`已限制：从第 ${a + 1} 条起取 ${b} 条（LIMIT offset, count）。`);
      } else {
        const m2 = text.match(/\bOFFSET\s+(\d+)/i);
        const offset = m2 ? Number(m2[1]) : 0;
        lines.push(offset ? `已限制：跳过 ${offset} 条，取 ${a} 条。` : `已限制：取前 ${a} 条。`);
      }
    }

    return lines.join('\n');
  }

  return null;
}
