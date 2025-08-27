import React from 'react';
import type { Column, Schema } from '../engine/types.ts';

/**
 * InsertData: Import CSV/Excel, preview rows, map columns, and generate INSERT SQL.
 *
 * NOTE: For Excel (.xlsx/.xls) support, install SheetJS:
 *   npm i xlsx
 */

export type InsertDataProps = {
  schema: Schema;                 // target table schema
  onRunSQL?: (sql: string) => void; // send generated SQL upward (e.g., into QueryPanel)
};

export default function InsertData({ schema, onRunSQL }: InsertDataProps) {
  const [fileName, setFileName] = React.useState<string>('');
  const [rows, setRows] = React.useState<any[]>([]); // parsed rows (array of objects with string keys)
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [hasHeader, setHasHeader] = React.useState<boolean>(true);
  const [delimiter, setDelimiter] = React.useState<string>(',');
  const [sheetNames, setSheetNames] = React.useState<string[] | null>(null);
  const [activeSheet, setActiveSheet] = React.useState<string | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({}); // targetCol -> sourceKey

  const table = schema?.tableName || 'table';
  const columns = schema?.columns || [];

  // --- helpers ---
  function literalForSQL(col: Column, raw: any): string {
    const t = String(col.type).toUpperCase();
    const v = raw === undefined || raw === null ? '' : String(raw);
    if (v === '') return 'NULL';
    if (t === 'INT' || t === 'INTEGER' || t === 'DECIMAL' || t === 'REAL' || t === 'FLOAT' || t === 'DOUBLE') {
      return v.trim();
    }
    if (t === 'BOOLEAN') {
      const s = v.trim().toLowerCase();
      if (['1','true','t','yes','y'].includes(s)) return 'TRUE';
      if (['0','false','f','no','n'].includes(s)) return 'FALSE';
      return 'FALSE';
    }
    // char/varchar/text: escape single quotes
    const esc = v.replace(/'/g, "''");
    return `'${esc}'`;
  }

  function autoMap(cols: Column[], hdrs: string[]) {
    const map: Record<string, string> = {};
    const lower = hdrs.map(h => h.toLowerCase());
    cols.forEach(c => {
      const i = lower.indexOf(c.name.toLowerCase());
      if (i >= 0) map[c.name] = hdrs[i];
    });
    return map;
  }

  function parseCSV(text: string, sep: string): string[][] {
    // RFC4180-ish parser: handle quoted fields and escaped quotes
    const out: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === '\n') { row.push(field); out.push(row); row = []; field = ''; }
        else if (ch === '\r') { /* ignore */ }
        else if (ch === sep) { row.push(field); field = ''; }
        else { field += ch; }
      }
    }
    // flush last field/row
    row.push(field);
    out.push(row);
    // Trim trailing empty line if present
    if (out.length && out[out.length - 1].length === 1 && out[out.length - 1][0] === '') out.pop();
    return out;
  }

  async function readExcel(file: File) {
    const XLSX = await import('xlsx');
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const names = wb.SheetNames;
    setSheetNames(names);
    const sheet = wb.Sheets[names[0]];
    setActiveSheet(names[0]);
    const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!json.length) { setRows([]); setHeaders([]); return; }
    const hdrs = Object.keys(json[0]);
    setHeaders(hdrs);
    setRows(json);
    setMapping(autoMap(columns, hdrs));
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const ext = f.name.toLowerCase().split('.').pop();
    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = () => {
        const txt = String(reader.result || '');
        const table = parseCSV(txt, delimiter || ',');
        if (!table.length) { setRows([]); setHeaders([]); return; }
        const hdrs = hasHeader ? table[0] : table[0].map((_, i) => `col_${i + 1}`);
        const body = hasHeader ? table.slice(1) : table;
        const objs = body.map(r => Object.fromEntries(hdrs.map((h, i) => [h, r[i] ?? ''])));
        setHeaders(hdrs);
        setRows(objs);
        setMapping(autoMap(columns, hdrs));
      };
      reader.readAsText(f);
    } else if (ext === 'xlsx' || ext === 'xls') {
      readExcel(f).catch(err => {
        console.error(err);
        alert('读取 Excel 失败，请确认已安装依赖 xlsx');
      });
    } else {
      alert('仅支持 .csv / .xlsx / .xls');
    }
  }

  function changeSheet(name: string) {
    setActiveSheet(name);
    // Re-read with selected sheet when using Excel — for simplicity, rely on re-upload or keep first sheet.
    // Advanced: store workbook object in state and re-run sheet_to_json here.
  }

  function applyMapping(col: string, src: string) {
    setMapping(prev => ({ ...prev, [col]: src }));
  }

  function buildInsertSQL(): string | null {
    if (!schema?.tableName || !schema?.columns?.length || rows.length === 0) return null;
    const cols = schema.columns.map(c => c.name);
    const tuples: string[] = [];
    for (const r of rows) {
      const vals = cols.map(name => {
        const src = mapping[name];
        const val = src ? r[src] : '';
        const col = schema.columns.find(c => c.name === name)!;
        return literalForSQL(col, val);
      });
      tuples.push(`(${vals.join(', ')})`);
    }
    return `INSERT INTO ${schema.tableName} (${cols.join(', ')}) VALUES\n  ${tuples.join(',\n  ')};`;
  }

  const previewRows = rows.slice(0, 10);
  const canGenerate = schema?.tableName && schema?.columns?.length && rows.length > 0;

  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 className="panel-title">导入数据（CSV / Excel）</h2>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} />
        {fileName && <span style={{ color: '#475569', fontSize: 12 }}>文件：{fileName}</span>}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>CSV 分隔符</span>
          <input className="input" style={{ width: 60 }} value={delimiter} onChange={e=>setDelimiter(e.target.value)} />
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={hasHeader} onChange={e=>setHasHeader(e.target.checked)} />
          <span style={{ fontSize: 12 }}>首行是表头</span>
        </label>
        {sheetNames && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>工作表</span>
            <select className="input" value={activeSheet || ''} onChange={e=>changeSheet(e.target.value)}>
              {sheetNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {/* Mapping UI */}
          <div style={{ flex: 1 }}>
            <h3 className="section-title" style={{ margin: 0 }}>列映射 → 目标表：{table}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
              {columns.map(c => (
                <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ width: '45%', fontWeight: 600 }}>{c.name}</div>
                  <select className="input" value={mapping[c.name] || ''} onChange={e=>applyMapping(c.name, e.target.value)}>
                    <option value="">(忽略该列 → NULL)</option>
                    {headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button
                className="nav-button"
                disabled={!canGenerate}
                onClick={() => {
                  const sql = buildInsertSQL();
                  if (!sql) return;
                  onRunSQL && onRunSQL(sql);
                }}
              >
                生成 INSERT SQL（发送到查询区）
              </button>
            </div>
          </div>

          {/* Preview */}
          <div style={{ flex: 1 }}>
            <h3 className="section-title" style={{ margin: 0 }}>预览（前 10 行）</h3>
            <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <table className="result-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <thead>
                  <tr>
                    {headers.map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i}>
                      {headers.map(h => <td key={h} style={{ wordBreak: 'break-word' }}>{String((r as any)[h] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <div style={{ color: '#64748b', fontSize: 12 }}>选择 CSV 或 Excel 文件以开始导入。建议列名与目标表列名一致，系统会自动尝试映射；你也可以在“列映射”中手动调整。</div>
      )}
    </section>
  );
}
