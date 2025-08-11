

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
