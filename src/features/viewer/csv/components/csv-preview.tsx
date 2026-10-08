import { DownloadIcon, FileCodeIcon, RowsIcon } from "@/ui/icons";
import { useMemo, useState } from "react";
import { useBufferText } from "@/features/editor/hooks/use-buffer-text";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { Button } from "@/ui/button";
import Select from "@/ui/select";
import { type CsvDelimiter, detectCsvDelimiter, formatCsv, parseCsv } from "../lib/csv-utils";
import { CsvTableView } from "./csv-table-view";

const CSV_PREVIEW_UPDATE_DELAY_MS = 150;

export function CsvPreview() {
  const sourceBufferId = useBufferStore((state) => {
    const activeBuffer = state.activeBufferId
      ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
      : null;
    const sourceFilePath =
      activeBuffer?.type === "csvPreview" ? activeBuffer.sourceFilePath : undefined;
    const sourceBuffer = sourceFilePath
      ? state.buffers.find((buffer) => buffer.path === sourceFilePath)
      : activeBuffer;
    return sourceBuffer && hasTextContent(sourceBuffer) ? sourceBuffer.id : null;
  });
  const sourceContent = useBufferText(sourceBufferId, { debounceMs: CSV_PREVIEW_UPDATE_DELAY_MS });
  const [delimiter, setDelimiter] = useState<CsvDelimiter | "auto">("auto");
  const [hasHeader, setHasHeader] = useState(true);

  const resolvedDelimiter = useMemo(
    () => (delimiter === "auto" ? detectCsvDelimiter(sourceContent) : delimiter),
    [sourceContent, delimiter],
  );
  const { headers, rows } = useMemo(
    () => parseCsv(sourceContent, resolvedDelimiter, hasHeader),
    [sourceContent, resolvedDelimiter, hasHeader],
  );

  const handleCopyCsv = async () => {
    try {
      await navigator.clipboard.writeText(
        formatCsv(hasHeader ? headers : null, rows, resolvedDelimiter),
      );
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
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <CsvTableView
        columns={headers}
        rows={rows}
        virtualize
        rowHeight={28}
        overscan={16}
        actions={
          <div className="flex items-center gap-1">
            {/* Delimiter selector */}
            <label
              htmlFor="csv-delimiter"
              className="font-sans mr-1 text-subtle-foreground ui-text-sm"
            >
              Delimiter
            </label>
            <Select
              id="csv-delimiter"
              value={delimiter}
              onChange={(value) => setDelimiter(value as any)}
              options={[
                { value: "auto", label: "Auto" },
                { value: ",", label: "Comma" },
                { value: "\t", label: "Tab" },
                { value: ";", label: "Semicolon" },
                { value: "|", label: "Pipe" },
              ]}
              className="min-w-24 rounded border-border px-1"
              title="Change delimiter"
            />
            {/* Header toggle */}
            <Button
              onClick={() => setHasHeader((v) => !v)}
              variant="default"
              size="sm"
              tooltip="Toggle header row"
            >
              <RowsIcon /> {hasHeader ? "Header On" : "Header Off"}
            </Button>
            {/* Copy CSV */}
            <Button onClick={handleCopyCsv} variant="default" size="sm" tooltip="Copy as CSV">
              <DownloadIcon optical="md" /> CSV
            </Button>
            {/* Copy JSON */}
            <Button onClick={handleCopyJson} variant="default" size="sm" tooltip="Copy as JSON">
              <FileCodeIcon /> JSON
            </Button>
          </div>
        }
      />
      {/* footer spacer or future actions */}
      <div className="h-0" />
    </div>
  );
}
