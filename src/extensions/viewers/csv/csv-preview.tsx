import { Download, FileJson, Rows } from "lucide-react";
import { useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useSettingsStore } from "@/features/settings/store";
import { TableView } from "@/ui/table-view";
import { parseCsv } from "./csv-utils";

type Delim = "," | "\t" | ";" | "|";

function autodetectDelimiter(text: string): Delim {
  // Sample first ~50 lines to score delimiters
  const lines = text.split("\n").slice(0, 50);
  const candidates: Delim[] = [",", "\t", ";", "|"];
  const scores = candidates.map((d) => {
    const counts = lines.map((l) => (l.match(new RegExp(`\\${d}`, "g")) || []).length);
    const mean = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, counts.length);
    return { d, mean, variance };
  });
  // Prefer higher mean (more columns) and lower variance (consistent)
  scores.sort((a, b) => b.mean - a.mean || a.variance - b.variance);
  return scores[0]?.d || ",";
}

export function CsvPreview() {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId);
  const fontSize = useEditorSettingsStore.use.fontSize();
  const uiFontFamily = useSettingsStore((state) => state.settings.uiFontFamily);

  // Get the source buffer if this is a preview buffer
  const sourceBuffer = activeBuffer?.sourceFilePath
    ? buffers.find((b) => b.path === activeBuffer.sourceFilePath)
    : activeBuffer;

  const [delimiter, setDelimiter] = useState<Delim | "auto">("auto");
  const [hasHeader, setHasHeader] = useState(true);

  const { headers, rows } = useMemo(() => {
    const content = sourceBuffer?.content ?? "";
    const delim = delimiter === "auto" ? autodetectDelimiter(content) : delimiter;
    return parseCsv(content, delim, hasHeader);
  }, [sourceBuffer?.content, delimiter, hasHeader]);

  const handleCopyCsv = async () => {
    try {
      const sep = delimiter === "\t" ? "\t" : delimiter;
      const head = headers.join(sep);
      const body = rows.map((r) => r.map((c) => String(c ?? "")).join(sep)).join("\n");
      const text = hasHeader ? `${head}\n${body}` : body;
      await navigator.clipboard.writeText(text);
    } catch {
      // no-op
    }
  };

  const handleCopyJson = async () => {
    try {
      const arr = rows.map((r) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h || `Column ${i + 1}`] = String(r[i] ?? "");
        });
        return obj;
      });
      await navigator.clipboard.writeText(JSON.stringify(arr, null, 2));
    } catch {
      // no-op
    }
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-primary-bg"
      style={{ fontSize: `${fontSize}px`, fontFamily: `${uiFontFamily}, sans-serif` }}
    >
      <TableView
        columns={headers}
        rows={rows}
        virtualize
        rowHeight={28}
        overscan={16}
        actions={
          <div className="flex items-center gap-1">
            {/* Delimiter selector */}
            <label htmlFor="csv-delimiter" className="ui-font mr-1 text-text-lighter text-xs">
              Delimiter
            </label>
            <select
              id="csv-delimiter"
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value as any)}
              className="ui-font rounded border border-border bg-secondary-bg px-1 py-0.5 text-text text-xs"
              title="Change delimiter"
            >
              <option value="auto">Auto</option>
              <option value=",">Comma</option>
              <option value="\t">Tab</option>
              <option value=";">Semicolon</option>
              <option value="|">Pipe</option>
            </select>

            {/* Header toggle */}
            <button
              onClick={() => setHasHeader((v) => !v)}
              className="flex h-6 items-center gap-1 rounded border border-border bg-secondary-bg px-2 text-text-lighter text-xs hover:bg-hover"
              title="Toggle header row"
            >
              <Rows size={12} /> {hasHeader ? "Header On" : "Header Off"}
            </button>

            {/* Copy CSV */}
            <button
              onClick={handleCopyCsv}
              className="flex h-6 items-center gap-1 rounded border border-border bg-secondary-bg px-2 text-text-lighter text-xs hover:bg-hover"
              title="Copy as CSV"
            >
              <Download size={12} /> CSV
            </button>

            {/* Copy JSON */}
            <button
              onClick={handleCopyJson}
              className="flex h-6 items-center gap-1 rounded border border-border bg-secondary-bg px-2 text-text-lighter text-xs hover:bg-hover"
              title="Copy as JSON"
            >
              <FileJson size={12} /> JSON
            </button>
          </div>
        }
      />
      {/* footer spacer or future actions */}
      <div className="h-0" />
    </div>
  );
}
