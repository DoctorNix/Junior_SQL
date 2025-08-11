// ------------------------------------
// Core Types for the Kids-style SQL Simulator
// ------------------------------------

export type ColType =
  | 'INTEGER' | 'INT'
  | 'REAL' | 'DECIMAL'
  | 'TEXT' | 'CHAR' | 'VARCHAR'
  | 'BOOLEAN';

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

