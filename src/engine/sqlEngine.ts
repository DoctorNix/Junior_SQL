import type { Database, QueryResult, Schema, Column, ColType, Row } from './types';

// --------------------------------------------------
// Public API
// NOTE: Current SELECT subset supports WHERE, GROUP BY, HAVING (alias-based), ORDER BY, LIMIT.
// JOIN is not supported yet (planned upgrade). HAVING supports conditions on SELECT aliases or GROUP BY columns.
// Added: DELETE (with FK actions: RESTRICT / CASCADE / SET NULL) and CREATE VIEW (materialized).
// --------------------------------------------------
export function runSQL(sql: string, db: Database, setDB: (next: Database) => void): QueryResult {
  const cleaned = stripComments(sql || '').trim();
  if (!cleaned) return emptyResult('Empty SQL');

  // DROP TABLE [IF EXISTS] table
  const dropMatch = cleaned.match(/^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?(\w+)\s*;?$/i);
  if (dropMatch) {
    const ifExists = !!dropMatch[1];
    const table = dropMatch[2];
    const exists = !!db.schemas[table];
    if (!exists) {
      if (ifExists) return msgResult(`Table ${table} does not exist — skipped.`);
      throw new Error('Unknown table: ' + table);
    }

    // Prevent dropping if referenced by FKs in other tables (schema-level check)
    const refs = listChildFKs(db, table);
    if (refs.length) {
      const by = refs.map(r => r.childTable).join(', ');
      throw new Error(`Cannot DROP TABLE ${table}: referenced by foreign keys in [${by}]`);
    }

    const nextSchemas = { ...db.schemas } as Record<string, Schema>;
    const nextRows = { ...db.rows } as Record<string, Row[]>;
    delete nextSchemas[table];
    delete nextRows[table];
    const nextActive = db.active === table ? Object.keys(nextSchemas)[0] || '' : db.active;
    setDB({ ...db, active: nextActive, schemas: nextSchemas, rows: nextRows });
    return msgResult(`Dropped table ${table}.`);
  }

  // Allow multiple CREATE TABLE statements separated by semicolons
  if (/^CREATE\s+TABLE/i.test(cleaned)) {
    const parsed = parseCreates(cleaned);
    const next: Database = { active: db.active, schemas: { ...db.schemas }, rows: { ...db.rows } };
    let created = 0;
    let last = db.active;
    for (const sc of parsed) {
      const exists = !!next.schemas[sc.tableName];
      const wantIfNotExists = !!(sc as any).meta?.createdWithIfNotExists;
      if (exists && wantIfNotExists) {
        // skip silently (or collect message if needed)
        continue;
      }
      if (exists && !wantIfNotExists) {
        throw new Error(`Table ${sc.tableName} already exists`);
      }
      next.schemas[sc.tableName] = sc;
      if (!next.rows[sc.tableName]) next.rows[sc.tableName] = [];
      last = sc.tableName;
      created++;
    }
    if (created > 0) {
      next.active = last;
      setDB(next);
      return msgResult(`Created ${created} table(s). Active: ${last}`);
    } else {
      // nothing created (all skipped by IF NOT EXISTS)
      return msgResult('No table created (all existed).');
    }
  }

  // CREATE VIEW view_name AS <select>
  const viewMatch = cleaned.match(/^CREATE\s+VIEW\s+(\w+)\s+AS\s+([\s\S]+)$/i);
  if (viewMatch) {
    const viewName = viewMatch[1];
    const selectSql = stripComments(viewMatch[2]).replace(/;\s*$/, '').trim();
    if (!/^SELECT\s+/i.test(selectSql)) throw new Error('CREATE VIEW expects: CREATE VIEW name AS SELECT ...');

    // evaluate the select to materialize the view now (simple, kid-friendly)
    const res = selectQuery(selectSql, db);

    // infer a lightweight schema from result columns
    const columns: Column[] = res.columns.map((colName) => {
      const values = res.rows.map(r => (r as any)[colName]).filter(v => v !== null && v !== undefined);
      const inferred: ColType = inferTypeFromValues(values);
      return { id: colName + '_' + Math.random().toString(36).slice(2,6), name: colName, type: inferred, primary: false } as Column;
    });

    const next: Database = {
      ...db,
      active: viewName,
      schemas: { ...db.schemas, [viewName]: { tableName: viewName, columns } },
      rows: { ...db.rows, [viewName]: res.rows.map(r => {
        const obj: Row = {};
        for (const c of res.columns) obj[c] = (r as any)[c];
        return obj;
      }) }
    };
    setDB(next);
    return msgResult(`Created view ${viewName} (materialized) with ${res.rows.length} row(s).`);
  }

  if (/^INSERT\s+/i.test(cleaned)) {
    const stmt = cleaned.replace(/;\s*$/, '');
    // Support: INSERT INTO tbl [(col,...)] VALUES (v1,...), (v1,...), ...
    const m = stmt.match(/^INSERT\s+INTO\s+(\w+)\s*(?:\(([^)]+)\))?\s+VALUES\s*(\(.+\))$/i);
    if (!m) throw new Error('Only supports: INSERT INTO table [(col, ...)] VALUES (val, ...)[, (val, ...), ...]');
    const tbl = m[1];
    if (!db.schemas[tbl]) throw new Error('Unknown table: ' + tbl);

    const schema = db.schemas[tbl];
    const colList = (m[2] ? m[2].split(',').map(s => s.trim()) : schema.columns.map(c => c.name));
    const valuesPart = m[3].trim();

    const groups = splitTuples(valuesPart); // ["(a,b)", "(c,d)"]
    if (!groups.length) throw new Error('No VALUES provided');

    const inserted: Row[] = [];
    for (const g of groups) {
      const inner = g.replace(/^\(/, '').replace(/\)$/, '');
      const rawVals = splitCSV(inner);
      if (colList.length !== rawVals.length) throw new Error('Columns/values length mismatch');
      const row: Row = {};
      colList.forEach((c, i) => (row[c] = parseLiteral(rawVals[i])));
      inserted.push(castRowTypes(row, schema));
    }

    // Constraint checks: stage rows in a temp buffer, then commit
    const current = db.rows[tbl] || [];
    const staged: Row[] = [...current];
    for (const r of inserted) {
      ensurePKUnique(db.schemas[tbl], staged, r);
      ensureUniqueKeys(db.schemas[tbl], staged, r);
      ensureFKs(db, db.schemas[tbl], r);
      staged.push(r);
    }

    const next: Database = { ...db, rows: { ...db.rows, [tbl]: staged } };
    setDB(next);

    // Return a concise message for batch, or the single row echo when only one
    if (inserted.length === 1) {
      const one = inserted[0];
      return { columns: Object.keys(one), rows: [one] };
    }
    return { columns: ['message', 'affected'], rows: [{ message: `Inserted ${inserted.length} row(s) into ${tbl}.`, affected: inserted.length }] };
  }

  if (/^UPDATE\s+/i.test(cleaned)) {
    return updateQuery(cleaned, db, setDB);
  }
  if (/^DELETE\s+/i.test(cleaned)) {
    return deleteQuery(cleaned, db, setDB);
  }
  if (!/^SELECT\s+/i.test(cleaned)) throw new Error('Supported statements: CREATE / INSERT / SELECT / UPDATE / DELETE / CREATE VIEW');

  return selectQuery(cleaned, db);
}

export function selectQuery(sql: string, db: Database): QueryResult {
  const s = stripComments(sql).replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
  const m = s.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+(\w+)(?:\s+(?!WHERE\b|GROUP\b|ORDER\b|LIMIT\b|JOIN\b)(\w+))?([\s\S]*)$/i);
  if (!m) throw new Error('Malformed SELECT');
  let selectPart = m[1].trim();
  let isDistinct = false;
  if (/^DISTINCT\b/i.test(selectPart)) {
    isDistinct = true;
    selectPart = selectPart.replace(/^DISTINCT\s+/i, '').trim();
  }
  const baseTable = m[2];
  const baseAlias = (m[3] || '').trim() || baseTable;
  let tail = m[4] || '';

  // 明确不支持 JOIN
  if (/\s+JOIN\s+/i.test(tail)) {
    throw new Error('JOIN is not supported yet (coming soon)');
  }

  // FROM base
  const base = getTableRows(baseTable, db);
  let rows = base.rows.map(r => ({ [baseAlias]: r }));

  // WHERE
  const whereMatch = tail.match(/\s+WHERE\s+([\s\S]*?)(?=\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|$)/i);
  if (whereMatch) {
    const whereExpr = whereMatch[1].trim();
    rows = rows.filter(r => evalBoolExpr(whereExpr, r));
  }

  // GROUP BY
  let groupCols: string[] | null = null;
  const groupMatch = tail.match(/\s+GROUP\s+BY\s+([\s\S]*?)(?=\s+HAVING|\s+ORDER\s+BY|\s+LIMIT|$)/i);
  if (groupMatch) groupCols = splitComma(groupMatch[1]);

  // HAVING (limit: only supports referencing SELECT aliases or GROUP BY columns)
  const havingMatch = tail.match(/\s+HAVING\s+([\s\S]*?)(?=\s+ORDER\s+BY|\s+LIMIT|$)/i);
  const havingExpr = havingMatch ? havingMatch[1].trim() : null;

  // 解析 SELECT 列
  const selectItems = splitComma(selectPart);
  const selectors = selectItems.map(parseSelectItem);

  let projected: Row[] = [];
  if (groupCols && groupCols.length) {
    const groups = new Map<string, any[]>();
    for (const row of rows) {
      const keyVals = groupCols.map(c => getValue(c, row));
      const key = JSON.stringify(keyVals);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    for (const [, gRows] of groups) {
      const out: Row = {};
      // Project strictly by SELECT items
      selectors.forEach(sel => {
        if (sel.kind === 'agg') {
          out[sel.alias] = computeAgg(sel.fn, sel.arg, gRows);
        } else if (sel.kind === 'col') {
          // take value from a representative row in the group
          out[sel.alias] = getValue(sel.expr, gRows[0]);
        } else if (sel.kind === 'star') {
          // In GROUP BY context, ignore '*' to avoid ambiguous expansion
          // (If needed later, we can expand from representative row.)
        }
      });
      // Apply HAVING on the aggregated row (supports alias-based conditions)
      if (havingExpr) {
        const keep = evalBoolExpr(havingExpr, out);
        if (!keep) continue;
      }
      projected.push(out);
    }
  } else {
    // 无分组：直接投影
    projected = rows.map(r => {
      const obj: Row = {};
      if (selectors.length === 1 && selectors[0].kind === 'star' && !selectors[0].table) {
        // SELECT * -> 扁平化当前表别名
        for (const t of Object.keys(r)) for (const [k, v] of Object.entries(r[t])) obj[`${t}.${k}`] = v;
      } else {
        selectors.forEach(sel => {
          if (sel.kind === 'star') {
            const t = sel.table!;
            const src = r[t] || {};
            for (const [k, v] of Object.entries(src)) obj[`${t}.${k}`] = v;
          } else if (sel.kind === 'col') {
            obj[sel.alias] = getValue(sel.expr, r);
          }
          // 无 GROUP BY 的聚合：全表聚合（在下方处理）
        });
      }
      return obj;
    });
    // 无 GROUP BY 时，如包含聚合，做全表聚合
    if (selectors.some(s => s.kind === 'agg')) {
      const out: Row = {};
      selectors.forEach(sel => {
        if (sel.kind === 'agg') out[sel.alias] = computeAgg(sel.fn, sel.arg, rows);
        else if (sel.kind === 'col') out[sel.alias] = projected[0]?.[sel.alias] ?? null;
      });
      // Apply HAVING if present (alias-based only)
      if (havingExpr) {
        const keep = evalBoolExpr(havingExpr, out);
        projected = keep ? [out] : [];
      } else {
        projected = [out];
      }
    }
  }

  // DISTINCT
  if (isDistinct) {
    const seen = new Set<string>();
    projected = projected.filter(r => {
      const key = JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ORDER BY (supports ordering by aliases; also fallback to baseAlias.<col> when using SELECT *)
  const orderMatch = tail.match(/\s+ORDER\s+BY\s+([\s\S]*?)(?=\s+LIMIT|$)/i);
  if (orderMatch) {
    const items = splitComma(orderMatch[1]).map(x => {
      const mm = x.match(/^(\S+)(?:\s+(ASC|DESC))?$/i);
      return { col: mm ? mm[1] : x, dir: (mm?.[2] || 'ASC').toUpperCase() } as { col: string; dir: 'ASC'|'DESC' };
    });
    const resolveOrderVal = (row: Row, key: string) => {
      if (key in row) return (row as any)[key];
      // For SELECT * (non-grouped) we expand as `${alias}.${col}` keys; try a fallback
      if (baseAlias && ((baseAlias + '.' + key) in (row as any))) return (row as any)[baseAlias + '.' + key];
      return (row as any)[key];
    };
    projected.sort((a, b) => {
      for (const it of items) {
        const av = resolveOrderVal(a as any, it.col);
        const bv = resolveOrderVal(b as any, it.col);
        if (av == bv) continue; // eslint-disable-line eqeqeq
        const cmp = av > bv ? 1 : -1;
        return it.dir === 'DESC' ? -cmp : cmp;
      }
      return 0;
    });
  }

  // LIMIT (support: LIMIT n  |  LIMIT n OFFSET m  |  LIMIT m, n)
  let lm = tail.match(/\s+LIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i);
  if (lm) {
    const n = parseInt(lm[1], 10);
    const off = parseInt(lm[2], 10);
    projected = projected.slice(off, off + n);
  } else {
    lm = tail.match(/\s+LIMIT\s+(\d+)\s*,\s*(\d+)/i);
    if (lm) {
      const off = parseInt(lm[1], 10);
      const n = parseInt(lm[2], 10);
      projected = projected.slice(off, off + n);
    } else {
      lm = tail.match(/\s+LIMIT\s+(\d+)/i);
      if (lm) projected = projected.slice(0, parseInt(lm[1], 10));
    }
  }

  const columns = projected.length ? Object.keys(projected[0]) : selectors.filter(s=>s.kind!=='star').map(s=>s.alias);
  return { columns, rows: projected };
}

// --------------------------------------------------
// Update TABLE parsing
// --------------------------------------------------

export function updateQuery(sql: string, db: Database, setDB: (next: Database) => void): QueryResult {
  const s = stripComments(sql).replace(/;\s*$/, '').trim();
  const m = s.match(/^UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if (!m) throw new Error('Malformed UPDATE. Expected: UPDATE table SET col=expr[, ...] [WHERE expr]');

  const table = m[1];
  const setPart = m[2];
  const wherePart = m[3]?.trim();

  const { schema, rows } = getTableRows(table, db);

  // 解析 SET：col = expr
  const assigns = splitComma(setPart).map(p => {
    const mm = p.match(/^(\w+)\s*=\s*([\s\S]+)$/);
    if (!mm) throw new Error('Bad SET item: ' + p);
    return { col: mm[1], expr: mm[2].trim() };
  });

  let affected = 0;
  const newRows = rows.map(orig => {
    const rowWrapper: any = { [table]: orig }; // 复用 WHERE 的取值逻辑
    const hit = wherePart ? evalBoolExpr(wherePart, rowWrapper) : true;
    if (!hit) return orig;

    const next: Row = { ...orig };
    for (const a of assigns) {
      const newVal = evalSetExpr(a.expr, rowWrapper);
      next[a.col] = newVal;
    }
    const casted = castRowTypes(next, schema);
    ensurePKUniqueOnUpdate(schema, rows, orig, casted);
    ensureUniqueKeysOnUpdate(schema, rows, orig, casted);
    ensureFKs(db, schema, casted);
    affected++;
    return casted;
  });

  const nextDB: Database = { ...db, rows: { ...db.rows, [table]: newRows } };
  // Defer setDB/return if there are FK onUpdate actions to propagate
  const childFKs = listChildFKs(db, table);
  if (!childFKs.length) {
    setDB(nextDB);
    return { columns: ['message', 'affected'], rows: [{ message: `Updated ${affected} row(s) in ${table}.`, affected }] };
  }
  // Propagate ON UPDATE actions if this table is referenced by children
  // Build maps from oldKey -> newKey for rows whose referenced key changed per FK
  const changesPerFk = childFKs.map(({ fk }) => ({ fk, map: new Map<string, string>() }));
  for (let i = 0; i < rows.length; i++) {
    const oldR = rows[i];
    const newR = newRows[i];
    for (const ch of changesPerFk) {
      const { fk, map } = ch as any;
      // Only consider changes on referenced columns
      const refOldProbe: Row = {}; const refNewProbe: Row = {};
      fk.refCols.forEach((c: string) => { refOldProbe[c] = oldR[c]; refNewProbe[c] = newR[c]; });
      const oldKey = tupleKey(fk.refCols, refOldProbe);
      const newKey = tupleKey(fk.refCols, refNewProbe);
      if (oldKey !== newKey) map.set(oldKey, newKey);
    }
  }
  // Apply per child table
  const nextRowsAfterUpdate: Record<string, Row[]> = { ...db.rows, [table]: newRows };
  for (const { childTable, childSchema, fk } of childFKs) {
    const pair = changesPerFk.find(x => x.fk === fk) as any;
    const changeMap: Map<string, string> = pair?.map || new Map();
    if (changeMap.size === 0) continue;
    const childAll = nextRowsAfterUpdate[childTable] || [];
    const updated: Row[] = [];
    for (const ch of childAll) {
      const probe: Row = {};
      fk.cols.forEach((c: string, i: number) => { probe[fk.refCols[i]] = ch[c]; });
      const childKey = tupleKey(fk.refCols, probe);
      if (!changeMap.has(childKey)) { updated.push(ch); continue; }
      const action = fk.onUpdate || 'RESTRICT';
      if (action === 'RESTRICT') {
        throw new Error(`UPDATE restricted by FK: ${childTable}(${fk.cols.join(',')}) -> ${table}(${fk.refCols.join(',')})`);
      } else if (action === 'SET_NULL') {
        const nr: Row = { ...ch };
        fk.cols.forEach((c: string) => { nr[c] = null; });
        updated.push(nr);
      } else if (action === 'CASCADE') {
        const newKey = changeMap.get(childKey)!; // string like JSON of array
        // We need to map back to values; since tupleKey uses JSON.stringify, parse it
        const vals = JSON.parse(newKey);
        const nr: Row = { ...ch };
        fk.cols.forEach((c: string, i: number) => { nr[c] = vals[i]; });
        updated.push(nr);
      }
    }
    nextRowsAfterUpdate[childTable] = updated;
  }
  const nextDB2: Database = { ...db, rows: nextRowsAfterUpdate };
  setDB(nextDB2);
  return { columns: ['message', 'affected'], rows: [{ message: `Updated ${affected} row(s) in ${table}. (propagated FK actions)`, affected }] };
}

// --------------------------------------------------
// DELETE FROM parsing with FK actions
// --------------------------------------------------

export function deleteQuery(sql: string, db: Database, setDB: (next: Database) => void): QueryResult {
  const s = stripComments(sql).replace(/;\s*$/, '').trim();
  const m = s.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if (!m) throw new Error('Malformed DELETE. Expected: DELETE FROM table [WHERE expr]');
  const table = m[1];
  const where = m[2]?.trim();

  const { schema, rows } = getTableRows(table, db);

  // mark rows to delete
  const toDeleteIdx: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rwrap: any = { [table]: rows[i] };
    const hit = where ? evalBoolExpr(where, rwrap) : true;
    if (hit) toDeleteIdx.push(i);
  }
  if (toDeleteIdx.length === 0) {
    return { columns: ['message', 'affected'], rows: [{ message: `Deleted 0 row(s) from ${table}.`, affected: 0 }] };
  }

  // Build new DB rows map we will mutate
  const nextRows: Record<string, Row[]> = { ...db.rows };

  // Gather concrete rows to delete from parent table
  const parentRows = rows.filter((_, idx) => toDeleteIdx.includes(idx));

  // Apply cascading to children recursively
  const visited = new Set<string>(); // key as table|idx to avoid double-delete
  function cascadeFrom(parentTable: string, parentSchema: Schema, doomedRows: Row[]) {
    // 1) For each child FK referencing parentTable
    const childFKs = listChildFKs(db, parentTable);
    for (const { childTable, childSchema, fk } of childFKs) {
      const childAll = nextRows[childTable] || [];
      // Build a set of parent keys for this fk (based on fk.refCols ordering)
      const parentKeySet = new Set<string>();
      for (const pr of doomedRows) {
        const probe: Row = {};
        fk.refCols.forEach((c, i) => { probe[c] = pr[c]; });
        parentKeySet.add(tupleKey(fk.refCols, probe));
      }

      // Scan child rows and classify matches
      const toNullIdx: number[] = [];
      const toDelIdx: number[] = [];
      for (let i = 0; i < childAll.length; i++) {
        const ch = childAll[i];
        const chKeyProbe: Row = {};
        fk.cols.forEach((c, j) => { chKeyProbe[fk.refCols[j]] = ch[c]; });
        const match = parentKeySet.has(tupleKey(fk.refCols, chKeyProbe));
        if (!match) continue;
        if (fk.onDelete === 'RESTRICT' || !fk.onDelete) {
          throw new Error(`DELETE restricted by FK: ${childTable}(${fk.cols.join(',')}) -> ${parentTable}(${fk.refCols.join(',')})`);
        } else if (fk.onDelete === 'CASCADE') {
          toDelIdx.push(i);
        } else if (fk.onDelete === 'SET_NULL') {
          toNullIdx.push(i);
        }
      }

      // Apply SET NULL
      if (toNullIdx.length) {
        const newChild = childAll.map((r, idx) => {
          if (!toNullIdx.includes(idx)) return r;
          const nr: Row = { ...r };
          fk.cols.forEach(c => { nr[c] = null; });
          return nr;
        });
        nextRows[childTable] = newChild;
      }

      // Apply CASCADE (delete) and recurse further for their own children
      if (toDelIdx.length) {
        const newChild = childAll.filter((_, idx) => !toDelIdx.includes(idx));
        const doomedChildren = childAll.filter((_, idx) => toDelIdx.includes(idx));
        nextRows[childTable] = newChild;
        if (doomedChildren.length) {
          cascadeFrom(childTable, childSchema, doomedChildren);
        }
      }
    }
  }

  cascadeFrom(table, schema, parentRows);

  // Finally, delete from parent table
  nextRows[table] = rows.filter((_, idx) => !toDeleteIdx.includes(idx));

  const affected = toDeleteIdx.length;
  const next: Database = { ...db, rows: nextRows };
  setDB(next);
  return { columns: ['message', 'affected'], rows: [{ message: `Deleted ${affected} row(s) from ${table}.`, affected }] };
}

function listChildFKs(db: Database, parentTable: string): { childTable: string; childSchema: Schema; fk: { cols: string[]; refTable: string; refCols: string[]; onDelete?: 'RESTRICT'|'CASCADE'|'SET_NULL'; onUpdate?: 'RESTRICT'|'CASCADE'|'SET_NULL'; } }[] {
  const out: { childTable: string; childSchema: Schema; fk: any }[] = [];
  for (const [t, sc] of Object.entries(db.schemas)) {
    const fks = (sc as any).foreignKeys as any[] | undefined;
    if (!fks || !fks.length) continue;
    for (const fk of fks) {
      if (fk.refTable === parentTable) out.push({ childTable: t, childSchema: sc, fk });
    }
  }
  return out;
}

// --------------------------------------------------
// CREATE TABLE parsing (subset)
// --------------------------------------------------

function parseCreates(sql: string): Schema[] {
  const stmts = sql
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
  return stmts.map(s => {
    const parsed = parseCreate(s + ';');
    if (!parsed) throw new Error('Invalid CREATE TABLE: ' + s);
    return parsed;
  });
}

function parseCreate(sql: string): Schema | null {
  try {
    const s = sql.trim().replace(/\s+/g, ' ').replace(/;$/, '');
    const m = s.match(/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.*)\)$/i);
    if (!m) return null;
    const hasIfNotExists = !!m[1];
    const tableName = m[2];
    const inner = m[3];

    const parts = splitComma(inner);

    const columns: Column[] = [];
    const primaryKey: string[] = [];
    const uniqueKeys: { columns: string[]; name?: string }[] = [];
    const foreignKeys: { cols: string[]; refTable: string; refCols: string[]; onDelete?: 'RESTRICT'|'CASCADE'|'SET_NULL'; onUpdate?: 'RESTRICT'|'CASCADE'|'SET_NULL'; }[] = [];

    for (const pRaw of parts) {
      const p = pRaw.trim();

      // Table-level PRIMARY KEY (a, b)
      if (/^PRIMARY\s+KEY\s*\(/i.test(p)) {
        const cols = p.match(/\(([^)]+)\)/)![1].split(',').map(s => s.trim());
        primaryKey.push(...cols);
        continue;
      }

      // Table-level UNIQUE (a, b) — allow optional CONSTRAINT name
      const um = p.match(/^(?:CONSTRAINT\s+(\w+)\s+)?UNIQUE\s*\(([^)]+)\)/i);
      if (um) {
        const name = um[1] || undefined;
        const cols = um[2].split(',').map(s => s.trim());
        uniqueKeys.push({ columns: cols, name });
        continue;
      }

      // Table-level FOREIGN KEY (... ) REFERENCES tbl(...)[ ON DELETE ...][ ON UPDATE ...]
      if (/^(CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY\s*\(/i.test(p)) {
        const cols = p.match(/FOREIGN\s+KEY\s*\(([^)]+)\)/i)![1].split(',').map(s => s.trim());
        const ref = p.match(/REFERENCES\s+(\w+)\s*\(([^)]+)\)/i);
        if (!ref) throw new Error('FOREIGN KEY needs REFERENCES table(cols)');
        const refTable = ref[1];
        const refCols = ref[2].split(',').map(s => s.trim());
        const del = p.match(/ON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL)/i)?.[1];
        const upd = p.match(/ON\s+UPDATE\s+(CASCADE|RESTRICT|SET\s+NULL)/i)?.[1];
        const norm = (x?: string) => x ? x.replace(/\s+/g,'_').toUpperCase() as 'CASCADE'|'RESTRICT'|'SET_NULL' : undefined;
        foreignKeys.push({ cols, refTable, refCols, onDelete: norm(del), onUpdate: norm(upd) });
        continue;
      }

      // Column definition
      const cm = p.match(/^(\w+)\s+([A-Z]+)(?:\s*\(([^)]+)\))?(.*)$/i);
      if (!cm) throw new Error('Unsupported column syntax: ' + p);

      const name = cm[1];
      let rawType = cm[2].toUpperCase();
      const paramStr = (cm[3] || '').trim();
      const rest = (cm[4] || '').toUpperCase();
      const primary = /PRIMARY\s+KEY/.test(rest);

      // normalize aliases
      if (rawType === 'INTEGER') rawType = 'INT';
      if (rawType === 'DEC' || rawType === 'NUMERIC') rawType = 'DECIMAL';
      if (rawType === 'FLOAT' || rawType === 'DOUBLE') rawType = 'REAL';

      const col: Column = {
        id: name + '_' + Math.random().toString(36).slice(2,6),
        name,
        type: rawType as ColType,
        primary,
      } as Column;

      if (rawType === 'CHAR' || rawType === 'VARCHAR') {
        const n = paramStr ? parseInt(paramStr, 10) : NaN;
        if (!Number.isFinite(n)) throw new Error(`${rawType} requires length, e.g. ${rawType}(20)`);
        (col as any).length = n;
      } else if (rawType === 'DECIMAL') {
        const ps = paramStr.split(',').map(s => parseInt(s.trim(), 10));
        if (!(ps.length === 2 && ps.every(n => Number.isFinite(n))))
          throw new Error('DECIMAL requires (precision, scale), e.g. DECIMAL(10,2)');
        (col as any).precision = ps[0];
        (col as any).scale = ps[1];
      } else if (rawType === 'INT' || rawType === 'REAL' || rawType === 'TEXT' || rawType === 'BOOLEAN') {
        // no params
      } else {
        throw new Error('Unsupported type: ' + rawType);
      }

      // Column-level UNIQUE
      if (/\bUNIQUE\b/.test(rest)) {
        uniqueKeys.push({ columns: [name] });
      }

      columns.push(col);
    }

    const schema: Schema = { tableName, columns } as Schema;
    if (primaryKey.length) schema.primaryKey = primaryKey;
    if (uniqueKeys.length) schema.uniqueKeys = uniqueKeys;
    if (foreignKeys.length) (schema as any).foreignKeys = foreignKeys;

    // Column-level PRIMARY flags -> primaryKey (single or composite when specified via table-level earlier)
    if (!schema.primaryKey) {
      const pkCols = columns.filter(c => (c as any).primary).map(c => c.name);
      if (pkCols.length >= 1) schema.primaryKey = pkCols;
    }

    // Auto PK injection/selection when still missing
    const meta: any = { createdWithIfNotExists: hasIfNotExists };
    if (!schema.primaryKey || schema.primaryKey.length === 0) {
      // Prefer existing column named 'id'
      const idCol = columns.find(c => c.name.toLowerCase() === 'id');
      if (idCol) {
        schema.primaryKey = [idCol.name];
        (idCol as any).primary = true;
        meta.autoPrimaryKey = { column: idCol.name, created: false, autoincrement: (idCol.type === 'INT' || idCol.type === 'INTEGER') };
      } else {
        // Inject synthetic id INT AUTOINCREMENT-like
        const newCol: Column = {
          id: 'id_' + Math.random().toString(36).slice(2,6),
          name: 'id',
          type: 'INT' as ColType,
          primary: true,
        } as any;
        (newCol as any).autoIncrement = true;
        columns.unshift(newCol);
        schema.primaryKey = ['id'];
        meta.autoPrimaryKey = { column: 'id', created: true, autoincrement: true };
      }
    }

    // Attach meta options
    (schema as any).meta = meta;

    return schema;
  } catch {
    return null;
  }
}

// --------------------------------------------------
// Expression tokenizer & evaluator for WHERE/HAVING
// --------------------------------------------------

type Token = { type: string; value: string };

type AST =
  | { kind: 'bin'; op: 'AND' | 'OR'; left: AST; right: AST }
  | { kind: 'cmp'; left: string; op: string; right: any }
  | { kind: 'like'; left: string; pattern: string }
  | { kind: 'group'; value: AST }
  | { kind: 'lit'; value: boolean };


function tokenize(input: string): Token[] {
  const out: Token[] = [];
  const re = /\s+|\(|\)|>=|<=|!=|=|>|<|\bAND\b|\bOR\b|\bNOT\b|\bIN\b|\bBETWEEN\b|\bIS\b|\bLIKE\b|\btrue\b|\bfalse\b|\bNULL\b|\*|[A-Za-z_][\w.]*|'[^']*'|"[^"]*"|\d*\.\d+|\d+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const t = m[0];
    if (/^\s+$/.test(t)) continue;
    let type = 'SYM';
    if (t === '(') type = 'LP';
    else if (t === ')') type = 'RP';
    else if ([ '>=','<=','!=','=', '>', '<' ].includes(t)) type = 'OP';
    else if (/^AND$/i.test(t)) type = 'AND';
    else if (/^OR$/i.test(t)) type = 'OR';
    else if (/^LIKE$/i.test(t)) type = 'LIKE';
    else if (/^true$/i.test(t) || /^false$/i.test(t)) type = 'BOOL';
    else if (/^NULL$/i.test(t)) type = 'NULL';
    else if (/^NOT$/i.test(t)) type = 'NOT';
    else if (/^IN$/i.test(t)) type = 'IN';
    else if (/^BETWEEN$/i.test(t)) type = 'BETWEEN';
    else if (/^IS$/i.test(t)) type = 'IS';
    else if (/^'[^']*'$/.test(t) || /^"[^"]*"$/.test(t)) type = 'STR';
    else if (/^\d*\.\d+$/.test(t) || /^\d+$/.test(t)) type = 'NUM';
    out.push({ type, value: t });
  }
  return out;
}

function literalFromToken(t: Token): any {
  if (t.type === 'STR') return stripQuotes(t.value);
  if (t.type === 'NUM') return Number(t.value);
  if (t.type === 'BOOL') return /^true$/i.test(t.value);
  if (t.type === 'NULL') return null;
  return t.value; // identifier will be resolved later via getValue
}

function parseBoolExpr(tokens: Token[]): AST {
  let i = 0;
  function parsePrimary(): AST {
    const t = tokens[i];
    if (!t) throw new Error('Bad expression');
    if (t.type === 'LP') { i++; const v = parseOr(); if (!tokens[i] || tokens[i].type !== 'RP') throw new Error('Missing )'); i++; return { kind: 'group', value: v }; }
    const leftTok = tokens[i++];
    const opTok = tokens[i++];
    if (!leftTok || !opTok) throw new Error('Bad comparison');

    // LIKE
    if (opTok.type === 'LIKE') {
      const patTok = tokens[i++];
      if (!patTok) throw new Error('LIKE needs pattern');
      return { kind: 'like', left: leftTok.value, pattern: stripQuotes(patTok.value) };
    }

    // IS [NOT] NULL
    if (opTok.type === 'IS') {
      let negate = false;
      if (tokens[i] && tokens[i].type === 'NOT') { negate = true; i++; }
      const what = tokens[i++];
      if (!what || what.type !== 'NULL') throw new Error('IS only supports NULL');
      return { kind: 'cmp', left: leftTok.value, op: negate ? 'IS_NOT_NULL' : 'IS_NULL', right: null } as any;
    }

    // [NOT] IN (...)
    if (opTok.type === 'IN' || opTok.type === 'NOT') {
      let negate = false;
      if (opTok.type === 'NOT') {
        const nxt = tokens[i++];
        if (!nxt || nxt.type !== 'IN') throw new Error('Expected IN after NOT');
        negate = true;
      }
      const lp = tokens[i++]; if (!lp || lp.type !== 'LP') throw new Error('IN expects (');
      const items: any[] = [];
      while (i < tokens.length && tokens[i].type !== 'RP') {
        const t = tokens[i++];
        if (!t) break;
        const lit = (t.type === 'SYM') ? t.value : literalFromToken(t);
        items.push(lit);
      }
      if (tokens[i] && tokens[i].type === 'RP') i++;
      return { kind: 'cmp', left: leftTok.value, op: negate ? 'NOT_IN' : 'IN', right: items } as any;
    }

    // BETWEEN a AND b
    if (opTok.type === 'BETWEEN') {
      const aTok = tokens[i++];
      const andTok = tokens[i++];
      const bTok = tokens[i++];
      if (!aTok || !andTok || !bTok || andTok.type !== 'AND') throw new Error('BETWEEN requires: expr BETWEEN a AND b');
      const a = (aTok.type === 'SYM') ? aTok.value : literalFromToken(aTok);
      const b = (bTok.type === 'SYM') ? bTok.value : literalFromToken(bTok);
      return { kind: 'cmp', left: leftTok.value, op: 'BETWEEN', right: { a, b } } as any;
    }

    if (opTok.type !== 'OP') throw new Error('Expected operator');
    const rightTok = tokens[i++]; if (!rightTok) throw new Error('Missing right side');
    return { kind: 'cmp', left: leftTok.value, op: opTok.value, right: literalFromToken(rightTok) };
  }
  function parseAnd(): AST { let node = parsePrimary(); while (tokens[i] && tokens[i].type === 'AND') { i++; const rhs = parsePrimary(); node = { kind: 'bin', op: 'AND', left: node, right: rhs }; } return node; }
  function parseOr(): AST { let node = parseAnd(); while (tokens[i] && tokens[i].type === 'OR') { i++; const rhs = parseAnd(); node = { kind: 'bin', op: 'OR', left: node, right: rhs }; } return node; }
  return parseOr();
}

function evalAst(ast: AST, row: any): boolean {
  switch (ast.kind) {
    case 'lit': return ast.value;
    case 'group': return evalAst(ast.value, row);
    case 'bin': return ast.op === 'AND' ? (evalAst(ast.left, row) && evalAst(ast.right, row)) : (evalAst(ast.left, row) || evalAst(ast.right, row));
    case 'like': {
      const lhs = getValue(ast.left, row) ?? '';
      const pattern = ast.pattern
        .replace(/([.*+?^${}()|[\]\\])/g, '\\$1')
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      return new RegExp(`^${pattern}$`, 'i').test(String(lhs));
    }
    case 'cmp': {
      const lhs = getValue(ast.left, row);
      const rhs = ast.right;
      switch (ast.op) {
        case '=': return lhs === rhs;
        case '!=': return lhs !== rhs;
        case '>': return (lhs as any) > (rhs as any);
        case '<': return (lhs as any) < (rhs as any);
        case '>=': return (lhs as any) >= (rhs as any);
        case '<=': return (lhs as any) <= (rhs as any);
        case 'IS_NULL': return lhs === null || lhs === undefined;
        case 'IS_NOT_NULL': return !(lhs === null || lhs === undefined);
        case 'IN': {
          const arr = Array.isArray(rhs) ? rhs : [];
          return arr.some((v: any) => valueEquals(lhs, v, row));
        }
        case 'NOT_IN': {
          const arr = Array.isArray(rhs) ? rhs : [];
          return !arr.some((v: any) => valueEquals(lhs, v, row));
        }
        case 'BETWEEN': {
          const a = (rhs as any).a;
          const b = (rhs as any).b;
          const lv = typeof lhs === 'number' ? lhs : Number(lhs);
          const av = typeof a === 'number' ? a : Number(valueOrGet(a, row));
          const bv = typeof b === 'number' ? b : Number(valueOrGet(b, row));
          return lv >= av && lv <= bv;
        }
        default: return false;
      }
    }
  }
}

// Boolean expression evaluator
function evalBoolExpr(expr: string, row: any): boolean {
  const tokens = tokenize(expr);
  const ast = parseBoolExpr(tokens);
  return evalAst(ast, row);
}

//Having is not supported yet
// function evalHaving(expr: string, row: any): boolean {
//   return evalBoolExpr(expr, row);
// }

// --------------------------------------------------
// Utilities
// --------------------------------------------------

function stripComments(input: string): string {
  // Remove block comments first
  const noBlock = input.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove full-line comments that start with common markers (after optional whitespace):
  // --, //, #, and full-width em dashes (— or ——)
  const noFullLine = noBlock
    .split(/\r?\n/)
    .map(line => (/^\s*(--|\/\/|#|—{1,2})/.test(line) ? '' : line))
    .join('\n');
  // Also strip trailing `-- ...` comments at end of code lines (best-effort; may affect strings but fine for our teaching scope)
  const noTrail = noFullLine.replace(/--.*$/gm, '');
  return noTrail;
}

function getTableRows(name: string, db: Database) {
  const schema = db.schemas[name];
  if (!schema) throw new Error('Unknown table: ' + name);
  const rows = db.rows[name] || [];
  return { schema, rows };
}

function splitComma(s: string): string[] {
  return s
    .split(/,(?=(?:[^()]*\([^()]*\))*[^()]*$)/)
    .map(x => x.trim())
    .filter(Boolean);
}

function aliasFromExpr(e: string) {
  return e.replace(/[^\w.]+/g, '_');
}

function getValue(expr: string, row: any) {
  if (expr.includes('.')) {
    const [t, c] = expr.split('.');
    return row[t]?.[c];
  }
  if (typeof row === 'object' && !Array.isArray(row)) {
    for (const t of Object.keys(row)) if (row[t] && row[t][expr] !== undefined) return row[t][expr];
  }
  return row[expr];
}

function computeAgg(fn: string, arg: string | '*', rows: any[]) {
  if (fn === 'COUNT' && arg === '*') return rows.length;
  const vals = arg === '*'
    ? rows.map(() => 1)
    : rows.map(r => getValue(arg as string, r)).filter(v => v !== null && v !== undefined);
  switch (fn) {
    case 'COUNT': return vals.length;
    case 'SUM': return vals.reduce((a: number, b: any) => a + Number(b || 0), 0);
    case 'AVG': { const n = vals.length; return n ? vals.reduce((a: number, b: any) => a + Number(b || 0), 0) / n : 0; }
    case 'MIN': return vals.reduce((a: any, b: any) => (a < b ? a : b), vals[0]);
    case 'MAX': return vals.reduce((a: any, b: any) => (a > b ? a : b), vals[0]);
    default: return null;
  }
}

function parseLiteral(token: string): any {
  const t = token.trim();
  if (/^'.*'$/.test(t) || /^".*"$/.test(t)) return t.slice(1, -1);
  if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
  if (/^NULL$/i.test(t)) return null;
  return t;
}

function evalSetExpr(expr: string, row: any): any {
  const e = expr.trim();

  // 标识符 / 字面量
  if (/^[A-Za-z_][\w.]*$/.test(e)) return getValue(e, row);
  if (/^'.*'$/.test(e) || /^".*"$/.test(e) || /^-?\d*(?:\.\d+)?$/.test(e) || /^(true|false|null)$/i.test(e)) {
    return parseLiteral(e);
  }

  // 简单二元运算：a + b / a - b / a * b / a / b
  const m = e.match(/^([A-Za-z_][\w.]*|-?\d*(?:\.\d+)?|'.*?'|".*?")\s*([+\-*/])\s*([A-Za-z_][\w.]*|-?\d*(?:\.\d+)?|'.*?'|".*?")$/);
  if (m) {
    const lhs = /^[A-Za-z_]/.test(m[1]) ? getValue(m[1], row) : parseLiteral(m[1]);
    const rhs = /^[A-Za-z_]/.test(m[3]) ? getValue(m[3], row) : parseLiteral(m[3]);
    switch (m[2]) {
      case '+': {
        const ln = Number(lhs), rn = Number(rhs);
        if (!Number.isNaN(ln) && !Number.isNaN(rn)) return ln + rn; // 数字相加
        return String(lhs ?? '') + String(rhs ?? '');               // 字符串拼接
      }
      case '-': return Number(lhs) - Number(rhs);
      case '*': return Number(lhs) * Number(rhs);
      case '/': return Number(lhs) / Number(rhs);
    }
  }

  // 回退：按字面量解析
  return parseLiteral(e);
}


function splitCSV(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = null; else cur += ch; }
    else { if (ch === "'" || ch === '"') q = ch; else if (ch === ',') { out.push(cur.trim()); cur = ''; continue; } else cur += ch; }
  }
  if (cur.trim().length || s.endsWith(',')) out.push(cur.trim());
  return out;
}

// Splits top-level parenthesized tuples, respecting quotes
function splitTuples(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      q = ch; cur += ch; continue;
    }
    if (ch === '(') { depth++; cur += ch; continue; }
    if (ch === ')') { depth--; cur += ch; if (depth === 0) { out.push(cur.trim()); cur = ''; } continue; }
    if (ch === ',' && depth === 0) { /* separator between tuples */ continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

function castRowTypes(row: Row, schema: Schema) {
  const typed: Row = {};
  for (const c of schema.columns) {
    let v = row[c.name];
    if (v === undefined) continue;
    switch (c.type) {
      case 'INT':
      case 'INTEGER': {
        v = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v), 10);
        break;
      }
      case 'REAL': {
        v = typeof v === 'number' ? v : parseFloat(String(v));
        break;
      }
      case 'DECIMAL': {
        const num = typeof v === 'number' ? v : parseFloat(String(v));
        const s = c.scale ?? 0;
        const factor = Math.pow(10, s);
        const rounded = Math.round((Number.isFinite(num) ? num : 0) * factor) / factor;
        v = rounded;
        break;
      }
      case 'CHAR': {
        let s = String(v ?? '');
        const n = c.length ?? s.length;
        if (s.length > n) s = s.slice(0, n);
        if (s.length < n) s = s.padEnd(n, ' ');
        v = s;
        break;
      }
      case 'VARCHAR': {
        let s = String(v ?? '');
        const n = c.length ?? s.length;
        if (s.length > n) s = s.slice(0, n);
        v = s;
        break;
      }
      case 'BOOLEAN': {
        v = !!v;
        break;
      }
      case 'TEXT':
      default: {
        v = String(v);
        break;
      }
    }
    typed[c.name] = v;
  }
  return typed;
}

function stripQuotes(s: string) {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) return s.slice(1, -1);
  return s;
}

function parseSelectItem(s: string):
  | { kind: 'star'; table?: string; alias: string }
  | { kind: 'col'; expr: string; alias: string }
  | { kind: 'agg'; fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; arg: string | '*'; alias: string } {
  if (s === '*') return { kind: 'star', alias: '*' } as any;
  const star = s.match(/^(\w+)\.\*$/);
  if (star) return { kind: 'star', table: star[1], alias: `${star[1]}.*` } as any;
  const agg = s.match(/^(COUNT|SUM|AVG|MIN|MAX)\((\*|[\w.]+)\)(?:\s+AS\s+(\w+))?$/i);
  if (agg) {
    const fn = agg[1].toUpperCase() as any;
    const arg = agg[2] === '*' ? '*' : agg[2];
    const alias = agg[3] || `${fn.toLowerCase()}`;
    return { kind: 'agg', fn, arg, alias } as any;
  }
  const ali = s.match(/^([\w.]+)(?:\s+AS\s+(\w+))?$/i);
  if (ali) return { kind: 'col', expr: ali[1], alias: ali[2] || aliasFromExpr(ali[1]) } as any;
  return { kind: 'col', expr: s, alias: aliasFromExpr(s) } as any;
}

function emptyResult(message: string): QueryResult {
  return { columns: ['message'], rows: [{ message }] };
}

function msgResult(message: string): QueryResult {
  return emptyResult(message);
}


function valueOrGet(v: any, row: any) {
  return typeof v === 'string' && /[A-Za-z_]/.test(v) && !/^'.*'$/.test(v) && !/^\".*\"$/.test(v) ? getValue(v, row) : v;
}

function valueEquals(a: any, b: any, row: any) {
  const av = valueOrGet(a, row);
  const bv = valueOrGet(b, row);
  return av === bv;
}

function inferTypeFromValues(values: any[]): ColType {
  // prefer BOOLEAN if all booleans
  if (values.length && values.every(v => typeof v === 'boolean')) return 'BOOLEAN';
  // if all numbers and all integers -> INT
  if (values.length && values.every(v => typeof v === 'number')) {
    if (values.every(v => Number.isInteger(v))) return 'INT';
    return 'REAL';
  }
  // default to TEXT (covers strings/mixed)
  return 'TEXT';
}

// --------------------------------------------------
// Constraint helpers (PK / UNIQUE / FK)
// --------------------------------------------------
function tupleKey(cols: string[], obj: Row) {
  return JSON.stringify(cols.map(c => obj[c] ?? null));
}

function ensurePKUnique(schema: Schema, existing: Row[], newRow: Row) {
  const pk = (schema as any).primaryKey as string[] | undefined;
  if (!pk || !pk.length) return;
  if (pk.some(c => newRow[c] === null || newRow[c] === undefined))
    throw new Error(`Primary key cannot be NULL: (${pk.join(', ')})`);
  const key = tupleKey(pk, newRow);
  const dup = existing.some(r => tupleKey(pk, r) === key);
  if (dup) throw new Error(`Duplicate primary key (${pk.join(', ')}): ${key}`);
}

function ensurePKUniqueOnUpdate(schema: Schema, allRows: Row[], oldRow: Row, newRow: Row) {
  const pk = (schema as any).primaryKey as string[] | undefined;
  if (!pk || !pk.length) return;
  if (pk.some(c => newRow[c] === null || newRow[c] === undefined))
    throw new Error(`Primary key cannot be NULL: (${pk.join(', ')})`);
  const oldKey = tupleKey(pk, oldRow);
  const newKey = tupleKey(pk, newRow);
  if (newKey === oldKey) return;
  const dup = allRows.some(r => tupleKey(pk, r) === newKey);
  if (dup) throw new Error(`Duplicate primary key on update: ${newKey}`);
}

function ensureUniqueKeys(schema: Schema, existing: Row[], newRow: Row) {
  const uks = readUniqueSets(schema);
  for (const uk of uks) {
    const hasNull = uk.some(c => newRow[c] === null || newRow[c] === undefined);
    if (hasNull) continue;
    const key = tupleKey(uk, newRow);
    const hit = existing.some(r => {
      const nullInR = uk.some(c => r[c] === null || r[c] === undefined);
      if (nullInR) return false;
      return tupleKey(uk, r) === key;
    });
    if (hit) throw new Error(`Unique constraint violated on (${uk.join(', ')})`);
  }
}

function ensureUniqueKeysOnUpdate(schema: Schema, allRows: Row[], oldRow: Row, newRow: Row) {
  const uks = readUniqueSets(schema);
  for (const uk of uks) {
    const hasNullNew = uk.some(c => newRow[c] === null || newRow[c] === undefined);
    if (hasNullNew) continue;
    const oldKey = tupleKey(uk, oldRow);
    const newKey = tupleKey(uk, newRow);
    if (newKey === oldKey) continue;
    const hit = allRows.some(r => {
      const nullInR = uk.some(c => r[c] === null || r[c] === undefined);
      if (nullInR) return false;
      return tupleKey(uk, r) === newKey;
    });
    if (hit) throw new Error(`Unique constraint violated on update (${uk.join(', ')})`);
  }
}

function readUniqueSets(schema: Schema): string[][] {
  const raw: any = (schema as any).uniqueKeys;
  if (!raw) return [];
  if (Array.isArray(raw) && raw.length > 0) {
    if (Array.isArray(raw[0])) return raw as string[][]; // legacy form
    return (raw as any[]).map(u => (u && Array.isArray(u.columns) ? u.columns : []));
  }
  return [];
}

function fkSatisfied(db: Database, fk: { cols: string[]; refTable: string; refCols: string[] }, row: Row) {
  if (fk.cols.some(c => row[c] === null || row[c] === undefined)) return true; // nullable FK allowed
  const refRows = db.rows[fk.refTable] || [];
  const probe: Row = {};
  fk.refCols.forEach((c, i) => { probe[c] = row[fk.cols[i]]; });
  const key = tupleKey(fk.refCols, probe);
  return refRows.some(r => tupleKey(fk.refCols, r) === key);
}

function ensureFKs(db: Database, schema: Schema, newRow: Row) {
  const fks = (schema as any).foreignKeys as { cols: string[]; refTable: string; refCols: string[] }[] | undefined;
  for (const fk of fks || []) {
    if (!fkSatisfied(db, fk, newRow)) {
      throw new Error(`Foreign key fails: (${fk.cols.join(', ')}) -> ${fk.refTable}(${fk.refCols.join(', ')})`);
    }
  }
}
