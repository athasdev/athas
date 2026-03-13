import { Code, Copy, Database, Download, Info, Settings, Table, Type } from "lucide-react";
import { cn } from "@/utils/cn";
import type { DatabaseInfo, ViewMode } from "../sqlite-types";

interface TableToolbarProps {
  fileName: string;
  dbInfo: DatabaseInfo | null;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  isCustomQuery: boolean;
  showColumnTypes: boolean;
  setShowColumnTypes: (show: boolean) => void;
  setIsCustomQuery: (is: boolean) => void;
  hasData: boolean;
  exportAsCSV: () => void;
  copyAsJSON: () => void;
}

const VIEW_TABS: { mode: ViewMode; icon: typeof Table; label: string }[] = [
  { mode: "data", icon: Table, label: "Data" },
  { mode: "schema", icon: Settings, label: "Schema" },
  { mode: "info", icon: Info, label: "Info" },
];

export default function TableToolbar({
  fileName,
  dbInfo,
  viewMode,
  setViewMode,
  isCustomQuery,
  showColumnTypes,
  setShowColumnTypes,
  setIsCustomQuery,
  hasData,
  exportAsCSV,
  copyAsJSON,
}: TableToolbarProps) {
  return (
    <div className="mx-2 mt-2 rounded-2xl bg-primary-bg/85 px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full bg-secondary-bg/70 px-2.5 py-1">
            <Database size={14} className="text-text-lighter" />
            <span className="text-sm">{fileName}</span>
            {dbInfo && (
              <span className="text-text-lighter text-xs">
                {dbInfo.tables}t {dbInfo.indexes}i
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-secondary-bg/60 p-0.5">
            {VIEW_TABS.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors",
                  viewMode === mode
                    ? "bg-selected text-text"
                    : "text-text-lighter hover:bg-hover hover:text-text",
                )}
                aria-label={`Switch to ${label} view`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {viewMode === "data" && !isCustomQuery && (
            <button
              onClick={() => setShowColumnTypes(!showColumnTypes)}
              className="flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-text-lighter text-xs hover:border-border/70 hover:bg-hover hover:text-text"
              aria-label="Toggle column types"
            >
              <Type size={12} />
              Types
            </button>
          )}
          {viewMode === "data" && (
            <button
              onClick={() => setIsCustomQuery(true)}
              className="flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-text-lighter text-xs hover:border-border/70 hover:bg-hover hover:text-text"
              disabled={isCustomQuery}
              aria-label="Open SQL editor"
            >
              <Code size={12} />
              SQL
            </button>
          )}
          {hasData && (
            <>
              <button
                onClick={exportAsCSV}
                className="flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-text-lighter text-xs hover:border-border/70 hover:bg-hover hover:text-text"
                aria-label="Export as CSV"
              >
                <Download size={12} />
                Export
              </button>
              <button
                onClick={copyAsJSON}
                className="flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-text-lighter text-xs hover:border-border/70 hover:bg-hover hover:text-text"
                aria-label="Copy as JSON"
              >
                <Copy size={12} />
                JSON
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
