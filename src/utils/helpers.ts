
// Generate a unique short id (for column/table ids)
export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// Deep clone an object/array to avoid state mutation issues
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// Capitalize first letter
export function capitalize(str: string) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Pad/truncate a string to a fixed length
export function padString(str: string, length: number) {
  const s = String(str ?? '');
  if (s.length >= length) return s.slice(0, length);
  return s + ' '.repeat(length - s.length);
}

// Format a value for display in a table cell
export function formatCell(v: any) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (s.length > 150) s = s.slice(0, 147) + '...';
  return s;
}

// Check if a value is numeric
export function isNumeric(val: any): boolean {
  return typeof val === 'number' && !isNaN(val);
}

// Convert SQL data type to display-friendly label
export function typeLabel(sqlType: string): string {
  const t = sqlType.toUpperCase();
  if (['INT', 'INTEGER', 'BIGINT', 'SMALLINT'].includes(t)) return 'Integer';
  if (['REAL', 'FLOAT', 'DOUBLE'].includes(t)) return 'Float';
  if (['CHAR', 'VARCHAR', 'TEXT'].includes(t)) return 'Text';
  if (['BOOLEAN', 'BOOL'].includes(t)) return 'Boolean';
  if (['DATE', 'DATETIME', 'TIMESTAMP'].includes(t)) return 'Date/Time';
  return t;
}

// Join multiple SQL column definitions into a CREATE TABLE snippet
export function joinColumnDefs(columns: { name: string; type: string; constraints?: string[] }[]): string {
  return columns
    .map(c => {
      const cons = c.constraints && c.constraints.length > 0 ? ' ' + c.constraints.join(' ') : '';
      return `${c.name} ${c.type}${cons}`;
    })
    .join(', ');
}
