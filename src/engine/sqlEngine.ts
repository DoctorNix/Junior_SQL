import type { Database, QueryResult, Schema, Column, ColType, Row } from './types.ts';

// --------------------------------------------------
// Public API
// NOTE: Current SELECT subset supports WHERE, GROUP BY, ORDER BY, LIMIT.
// JOIN and HAVING are intentionally not supported (planned upgrade).
// --------------------------------------------------
export function runSQL(sql: string, db: Database, setDB: (next: Database) => void): QueryResult {
  const cleaned = stripComments(sql || '').trim();
  if (!cleaned) return emptyResult('Empty SQL');

  // Allow multiple CREATE TABLE statements separated by semicolons
  if (/^CREATE\s+TABLE/i.test(cleaned)) {
    const schemas = parseCreates(cleaned);
    const next: Database = {
      active: db.active,
      schemas: { ...db.schemas },
      rows: { ...db.rows },
    };
    let last = db.active;
    for (const sc of schemas) {
      next.schemas[sc.tableName] = sc;
      if (!next.rows[sc.tableName]) next.rows[sc.tableName] = [];
      last = sc.tableName;
    }
    next.active = last;
    setDB(next);
    return msgResult(`Created ${schemas.length} table(s). Active: ${last}`);
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

    const next: Database = { ...db, rows: { ...db.rows, [tbl]: [...(db.rows[tbl] || []), ...inserted] } };
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
    
  if (!/^SELECT\s+/i.test(cleaned)) throw new Error('Supported statements: CREATE / INSERT / SELECT / UPDATE / CREATE VIEW');

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

  // 明确不支持 HAVING
  if (/\s+HAVING\s+/i.test(tail)) {
    throw new Error('HAVING is not supported yet (coming soon)');
  }

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
      projected = [out];
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

  // ORDER BY
  const orderMatch = tail.match(/\s+ORDER\s+BY\s+([\s\S]*?)(?=\s+LIMIT|$)/i);
  if (orderMatch) {
    const items = splitComma(orderMatch[1]).map(x => {
      const mm = x.match(/^(\S+)(?:\s+(ASC|DESC))?$/i);
      return { col: mm ? mm[1] : x, dir: (mm?.[2] || 'ASC').toUpperCase() };
    });
    projected.sort((a,b) => {
      for (const it of items) {
        const av = a[it.col]; const bv = b[it.col];
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
    affected++;
    return castRowTypes(next, schema);
  });

  const nextDB: Database = { ...db, rows: { ...db.rows, [table]: newRows } };
  setDB(nextDB);
  return { columns: ['message', 'affected'], rows: [{ message: `Updated ${affected} row(s) in ${table}.`, affected }] };
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
    const m = s.match(/^CREATE TABLE (\w+) \((.*)\)$/i);
    if (!m) return null;
    const tableName = m[1];
    const inner = m[2];
    const parts = splitComma(inner);
    // 替换原先的 columns 解析
    const columns: Column[] = parts.map(p => {
    // allow: INT/INTEGER, REAL, TEXT, BOOLEAN, CHAR(n), VARCHAR(n), DECIMAL(p,s)
    const m = p.match(/^(\w+)\s+([A-Z]+)(?:\s*\(([^)]+)\))?(.*)$/i);
    if (!m) throw new Error('Unsupported column syntax: ' + p);

    const name = m[1];
    let rawType = m[2].toUpperCase();
    const paramStr = (m[3] || '').trim();
    const rest = (m[4] || '').toUpperCase();
    const primary = /PRIMARY\s+KEY/.test(rest);

    // normalize aliases
    if (rawType === 'INTEGER') rawType = 'INT';
    if (rawType === 'DEC' || rawType === 'NUMERIC') rawType = 'DECIMAL';

    const col: Column = {
        id: name + '_' + Math.random().toString(36).slice(2,6),
        name,
        type: rawType as ColType,
        primary,
    };

    if (rawType === 'CHAR' || rawType === 'VARCHAR') {
        const n = paramStr ? parseInt(paramStr, 10) : NaN;
        if (!Number.isFinite(n)) throw new Error(`${rawType} requires length, e.g. ${rawType}(20)`);
        col.length = n;
    } else if (rawType === 'DECIMAL') {
        const ps = paramStr.split(',').map(s => parseInt(s.trim(), 10));
        if (!(ps.length === 2 && ps.every(n => Number.isFinite(n))))
        throw new Error('DECIMAL requires (precision, scale), e.g. DECIMAL(10,2)');
        col.precision = ps[0];
        col.scale = ps[1];
    } else if (rawType === 'INT' || rawType === 'REAL' || rawType === 'TEXT' || rawType === 'BOOLEAN') {
        // no params
    } else {
        throw new Error('Unsupported type: ' + rawType);
    }

    return col;
});
    return { tableName, columns };
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
  // Remove line comments starting with -- and block comments /* ... */
  return input
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
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
