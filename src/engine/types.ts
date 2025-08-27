// ------------------------------------
// Core Types for the Kids-style SQL Simulator
// ------------------------------------

export type ColType =
  | 'INTEGER' | 'INT'
  | 'REAL' | 'DECIMAL' | 'FLOAT' | 'DOUBLE'
  | 'TEXT' | 'CHAR' | 'VARCHAR'
  | 'BOOLEAN'
  | 'DATE' | 'TIME' | 'DATETIME' | 'BLOB'; // Pre-reserved types for future expansion

/**
 * Engine-wide normalized primitive types. Use this when you want a canonical type
 * instead of synonyms. For example, both 'INT' and 'INTEGER' → 'INT';
 * 'TEXT'/'CHAR'/'VARCHAR' → 'TEXT'.
 */

export type NormalizedType = 'INT' | 'REAL' | 'DECIMAL' | 'TEXT' | 'BOOLEAN' | 'DATE' | 'TIME' | 'DATETIME' | 'BLOB';

/**
 * Normalize a ColType into a canonical NormalizedType.
 */
export function normalizeType(t: ColType): NormalizedType {
  switch (t) {
    case 'INT':
    case 'INTEGER':
      return 'INT';
    case 'REAL':
    case 'FLOAT':
    case 'DOUBLE':
      return 'REAL';
    case 'DECIMAL':
      return 'DECIMAL';
    case 'TEXT':
    case 'CHAR':
    case 'VARCHAR':
      return 'TEXT';
    case 'BOOLEAN':
      return 'BOOLEAN';
    case 'DATE':
      return 'DATE';
    case 'TIME':
      return 'TIME';
    case 'DATETIME':
      return 'DATETIME';
    case 'BLOB':
      return 'BLOB';
    default:
      // Fallback to TEXT for unknown strings; keeps simulator resilient
      return 'TEXT';
  }
}

/** Common buckets used around UI/engine to reason about columns. */
export const NUMERIC_TYPES: ColType[] = ['INT', 'INTEGER', 'REAL', 'DECIMAL', 'FLOAT', 'DOUBLE'];
export const TEXTUAL_TYPES: ColType[] = ['TEXT', 'CHAR', 'VARCHAR'];

export function isNumericCol(c?: Column | null): c is Column {
  return !!c && NUMERIC_TYPES.includes(c.type);
}
export function isTextCol(c?: Column | null): c is Column {
  return !!c && TEXTUAL_TYPES.includes(c.type);
}

// ------------------------------------
// Views (logical, non-materialized by default)
// ------------------------------------
export type ViewSpec = {
  /** View name */
  name: string;
  /** Original SQL text for the view definition */
  sql: string;
  /** Optional explicit column list in the view definition */
  columns?: string[];
  /** Table/view names referenced by this view (best-effort) */
  deps?: string[];
  /** Teaching flag: if true, treat as materialized view in the simulator */
  materialized?: boolean;
};

// ------------------------------------
// Triggers (teaching-oriented, optional)
// ------------------------------------
export type TriggerTiming = 'BEFORE' | 'AFTER';
export type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE';
export type TriggerSpec = {
  /** Trigger name */
  name: string;
  /** Target table name */
  table: string;
  /** BEFORE/AFTER */
  timing: TriggerTiming;
  /** INSERT/UPDATE/DELETE */
  event: TriggerEvent;
  /** Optional column list for UPDATE OF ... */
  ofColumns?: string[];
  /** Body SQL text (single statement or simplified block) */
  bodySQL: string;
  /** Teaching flags */
  enabled?: boolean;
};

// ------------------------------------
// Sequences (for AUTOINCREMENT-like behavior)
// ------------------------------------
export type SequenceSpec = {
  name: string;
  current: number;      // current value (last issued)
  increment?: number;   // default 1
  min?: number;         // optional
  max?: number;         // optional
  cycle?: boolean;      // wrap around when exceeding max
};

export type UniqueSpec = {
  /** Optional constraint name */
  name?: string;
  /** Columns participating in the unique constraint (composite supported) */
  columns: string[];
};

export type ForeignKeyAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';

export type ForeignKeySpec = {
  /** Optional constraint name */
  name?: string;
  /** Local (child) columns */
  columns: string[];
  /** Referenced table name */
  refTable: string;
  /** Referenced (parent) columns */
  refColumns: string[];
  /** ON DELETE action */
  onDelete?: ForeignKeyAction;
  /** ON UPDATE action */
  onUpdate?: ForeignKeyAction;
  /** DEFERRABLE (teaching flag only; engine may or may not enforce) */
  deferrable?: boolean;
  /** INITIALLY DEFERRED (teaching flag only) */
  initiallyDeferred?: boolean;
};

export type CheckSpec = {
  /** Optional constraint name */
  name?: string;
  /** Raw SQL expression text to be evaluated per-row or per-table */
  expr: string;
};

export type IndexSpec = {
  /** Optional index name */
  name?: string;
  /** Indexed columns (order as defined) */
  columns: string[];
  /** Whether the index enforces uniqueness */
  unique?: boolean;
};

export type Schema = {
  tableName: string;
  columns: Column[];

  /** Table-level primary key (composite allowed). */
  primaryKey?: string[];

  /** One or more UNIQUE constraints (each defined by a set of column names). */
  uniqueKeys?: UniqueSpec[];

  /** Zero or more foreign keys defined on this table. */
  foreignKeys?: ForeignKeySpec[];

  /** Optional table-level CHECK constraints. */
  checks?: CheckSpec[];

  /** Optional secondary indexes. */
  indexes?: IndexSpec[];

  /** Optional, non-semantic metadata about how this table was created. */
  meta?: TableOptions;
};

export type Column = {
  id: string;
  name: string;
  type: ColType;         // 解析后建议通过 normalizeType() 归一为 INT/REAL/DECIMAL/TEXT/BOOLEAN
  nullable?: boolean;        // 默认可空；若显式 NOT NULL 则为 false
  primary?: boolean;
  // 带参数类型的可选元数据
  length?: number;       // CHAR(N) / VARCHAR(N)
  precision?: number;    // DECIMAL(p,s) 的 p
  scale?: number;        // DECIMAL(p,s) 的 s
  // 约束/默认值（可选，未来逐步实现）
  defaultExpr?: string;     // DEFAULT 表达式（保存原始 SQL 文本即可）
  checkExpr?: string;       // 列级 CHECK 表达式（原始 SQL 文本）
  autoIncrement?: boolean;  // 是否自增（教学用途）
  autoSeed?: number;        // 自增起始值（默认 1）
  autoStep?: number;        // 自增步长（默认 1）

  // Collation & references
  collation?: string;     // e.g., 'BINARY', 'NOCASE' (teaching/demo only)
  references?: {          // column-level foreign key (sugar for ForeignKeySpec)
    table: string;
    columns: string[];    // usually single-column
    onDelete?: ForeignKeyAction;
    onUpdate?: ForeignKeyAction;
  };
  // Generated columns
  generated?: {
    expr: string;         // generation expression text
    stored?: boolean;     // true = STORED, false = VIRTUAL
  };
};

/** Metadata & create-time options for a table (non-semantic, for UI/engine helpers). */
export type TableOptions = {
  /** Whether the engine auto-injected a primary key because none was provided. */
  autoPrimaryKey?: {
    /** The column name that was auto-added or chosen as PK (e.g., 'id'). */
    column: string;
    /** Whether this PK column was newly created (true) vs using an existing column (false). */
    created: boolean;
    /** Whether the column is AUTOINCREMENT-like (teaching purpose only). */
    autoincrement?: boolean;
  };
  /** Whether the table was created with IF NOT EXISTS (helps UI avoid noisy errors). */
  createdWithIfNotExists?: boolean;
};

// ------------------------------------
// Table Constraints & Index Specs (kept for FK/UNIQUE/CHECK support)
// ------------------------------------

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
  /** view registry (by name) */
  views?: Record<string, ViewSpec>;
  /** trigger registry (by name) */
  triggers?: Record<string, TriggerSpec>;
  /** sequence registry (by name) */
  sequences?: Record<string, SequenceSpec>;
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

/** Temporal (date/time) types bucket (pre-reserved for expansion). */
export const TEMPORAL_TYPES: ColType[] = ['DATE', 'TIME', 'DATETIME'];

/** Binary types bucket (pre-reserved for expansion). */
export const BINARY_TYPES: ColType[] = ['BLOB'];
