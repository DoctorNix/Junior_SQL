// ------------------------------------
// Core Types for the Kids-style SQL Simulator
// ------------------------------------

export type ColType =
  | 'INTEGER' | 'INT'
  | 'REAL' | 'DECIMAL'
  | 'TEXT' | 'CHAR' | 'VARCHAR'
  | 'BOOLEAN';

/**
 * Engine-wide normalized primitive types. Use this when you want a canonical type
 * instead of synonyms. For example, both 'INT' and 'INTEGER' → 'INT';
 * 'TEXT'/'CHAR'/'VARCHAR' → 'TEXT'.
 */
export type NormalizedType = 'INT' | 'REAL' | 'DECIMAL' | 'TEXT' | 'BOOLEAN';

/**
 * Normalize a ColType into a canonical NormalizedType.
 */
export function normalizeType(t: ColType): NormalizedType {
  switch (t) {
    case 'INT':
    case 'INTEGER':
      return 'INT';
    case 'REAL':
      return 'REAL';
    case 'DECIMAL':
      return 'DECIMAL';
    case 'TEXT':
    case 'CHAR':
    case 'VARCHAR':
      return 'TEXT';
    case 'BOOLEAN':
      return 'BOOLEAN';
    default:
      // Fallback to TEXT for unknown strings; keeps simulator resilient
      return 'TEXT';
  }
}

/** Common buckets used around UI/engine to reason about columns. */
export const NUMERIC_TYPES: ColType[] = ['INT', 'INTEGER', 'REAL', 'DECIMAL'];
export const TEXTUAL_TYPES: ColType[] = ['TEXT', 'CHAR', 'VARCHAR'];

export function isNumericCol(c?: Column | null): c is Column {
  return !!c && NUMERIC_TYPES.includes(c.type);
}
export function isTextCol(c?: Column | null): c is Column {
  return !!c && TEXTUAL_TYPES.includes(c.type);
}

export type Column = {
  id: string;
  name: string;
  type: ColType;         // 归一化后的基本类型
  primary?: boolean;
  // 带参数类型的可选元数据
  length?: number;       // CHAR(N) / VARCHAR(N)
  precision?: number;    // DECIMAL(p,s) 的 p
  scale?: number;        // DECIMAL(p,s) 的 s
};

export type Schema = {
  tableName: string;
  columns: Column[];
};

export type Row = Record<string, any>;

export type QueryResult = {
  columns: string[]; // column order for rendering
  rows: Row[];       // result rows (flat objects)
};

/**
 * Database is an in-memory structure; engine functions mutate via setDB(next).
 * - `schemas[table]` should always exist when `rows[table]` exists.
 * - `active` is the table shown in PlayLab's data view; pages may override.
 */
export type Database = {
  /** currently selected table for PlayLab data view */
  active: string;
  /** table schemas */
  schemas: Record<string, Schema>;
  /** table data */
  rows: Record<string, Row[]>;
};

// Utility helpers' shapes (for engine function signatures)
export type RunSQL = (
  sql: string,
  db: Database,
  setDB: (next: Database) => void
) => QueryResult;

export type SelectQuery = (
  sql: string,
  db: Database
) => QueryResult;

