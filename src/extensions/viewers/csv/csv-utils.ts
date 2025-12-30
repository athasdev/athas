export interface ParsedCsv {
  headers: string[];
  rows: (string | number | boolean | null)[][];
}

// Very light CSV parser supporting quoted fields and basic delimiters
export function parseCsv(
  text: string,
  delimiter: "," | "\t" | ";" | "|" = ",",
  hasHeader = true,
): ParsedCsv {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const flushField = () => {
    row.push(field);
    field = "";
  };

  const flushRow = () => {
    // Avoid pushing a trailing empty row for empty input
    if (row.length > 0) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        flushField();
      } else if (ch === "\n") {
        flushField();
        flushRow();
      } else if (ch === "\r") {
      } else {
        field += ch;
      }
    }
  }

  // flush last field and row
  if (field.length > 0 || row.length > 0) {
    flushField();
    flushRow();
  }

  let headers: string[] = [];
  let dataRows: string[][] = rows;
  if (hasHeader && rows.length > 0) {
    headers = rows[0];
    dataRows = rows.slice(1);
  } else {
    const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    headers = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
  }

  // Normalize row lengths to header length
  const normalized = dataRows.map((r) => {
    const copy = [...r];
    if (copy.length < headers.length) {
      while (copy.length < headers.length) copy.push("");
    }
    return copy;
  });

  return { headers, rows: normalized };
}
