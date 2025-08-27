import React from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

interface DataExportProps {
  data: any[];
  filename?: string;
}

const DataExport: React.FC<DataExportProps> = ({ data, filename }) => {
  const getFilename = (ext: string) => (filename ? filename.replace(/\.[^/.]+$/, "") : "export") + ext;

  const exportToCSV = () => {
    if (!data || data.length === 0) return;
    const csvRows: string[] = [];
    // Extract headers
    const headers = Object.keys(data[0]);
    csvRows.push(headers.join(","));
    // Map data rows
    for (const row of data) {
      const values = headers.map((header) => {
        const val = row[header];
        // Escape double quotes and wrap in quotes if needed
        if (typeof val === "string") {
          const escaped = val.replace(/"/g, '""');
          return `"${escaped}"`;
        }
        return val !== undefined && val !== null ? val : "";
      });
      csvRows.push(values.join(","));
    }
    const csvString = csvRows.join("\r\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, getFilename(".csv"));
  };

  const exportToExcel = () => {
    if (!data || data.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([excelBuffer], { type: "application/octet-stream" });
    saveAs(blob, getFilename(".xlsx"));
  };

  return (
    <div>
      <button onClick={exportToCSV}>Export to CSV</button>
      <button onClick={exportToExcel}>Export to Excel</button>
    </div>
  );
};

export default DataExport;

