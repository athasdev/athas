interface ParsedCsv {
  headers: string[];
  rows: (string | number | boolean | null)[][];
}

export type CsvDelimiter = "," | "\t" | ";" | "|";

const CSV_DELIMITERS: CsvDelimiter[] = [",", "\t", ";", "|"];

/**
 * Pick the delimiter that splits the first lines into the most, and most consistent, columns.
 */
export function detectCsvDelimiter(text: string): CsvDelimiter {
  const lines = text.split("\n").slice(0, 50);
  const scores = CSV_DELIMITERS.map((delimiter) => {
    const counts = lines.map((line) => line.split(delimiter).length - 1);
    const mean = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, counts.length);
    return { delimiter, mean, variance };
  });
  scores.sort((a, b) => b.mean - a.mean || a.variance - b.variance);
  return scores[0]?.delimiter ?? ",";
}

function formatCsvField(value: string | number | boolean | null, delimiter: CsvDelimiter) {
  const text = String(value ?? "");
  const needsQuotes =
    text.includes(delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r");
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serialize a parsed table back to delimited text, quoting fields that need it.
 */
export function formatCsv(
  headers: string[] | null,
  rows: ParsedCsv["rows"],
  delimiter: CsvDelimiter,
): string {
  return [...(headers ? [headers] : []), ...rows]
    .map((row) => row.map((value) => formatCsvField(value, delimiter)).join(delimiter))
    .join("\n");
}

export function parseCsv(text: string, delimiter: CsvDelimiter = ",", hasHeader = true): ParsedCsv {
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
