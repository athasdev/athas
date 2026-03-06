import { useState } from "react";
import { cn } from "@/utils/cn";
import type { ForeignKeyInfo } from "../types";

interface CellRendererProps {
  value: unknown;
  columnName: string;
  isPrimaryKey: boolean;
  foreignKey?: ForeignKeyInfo;
  onFkClick?: (columnName: string, value: unknown) => void;
  onContextMenu?: (e: React.MouseEvent, value: unknown, columnName: string) => void;
}

export default function CellRenderer({
  value,
  columnName,
  isPrimaryKey,
  foreignKey,
  onFkClick,
  onContextMenu,
}: CellRendererProps) {
  const [expanded, setExpanded] = useState(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    onContextMenu?.(e, value, columnName);
  };

  if (value === null || value === undefined) {
    return (
      <span
        className="rounded bg-text-lighter/10 px-1 py-0.5 font-mono text-text-lighter text-xs italic"
        onContextMenu={handleContextMenu}
      >
        NULL
      </span>
    );
  }

  // JSON detection
  if (typeof value === "string" && isJsonString(value)) {
    return (
      <span onContextMenu={handleContextMenu}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="block max-w-[280px] truncate text-left font-mono text-accent"
          title="Click to expand JSON"
        >
          {expanded ? value : truncateText(value, 50)}
        </button>
        {expanded && (
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-secondary-bg/80 p-2 font-mono text-xs">
            {formatJson(value)}
          </pre>
        )}
      </span>
    );
  }

  // Date detection
  if (typeof value === "string" && isIsoDate(value)) {
    return (
      <span className="block truncate" title={value} onContextMenu={handleContextMenu}>
        {formatDate(value)}
      </span>
    );
  }

  // Unix timestamp detection
  if (typeof value === "number" && isUnixTimestamp(value)) {
    const dateStr = new Date(value * 1000).toISOString();
    return (
      <span className="block truncate" title={`Raw: ${value}`} onContextMenu={handleContextMenu}>
        {formatDate(dateStr)}
      </span>
    );
  }

  // Foreign key value
  if (foreignKey && onFkClick) {
    return (
      <button
        onClick={() => onFkClick(columnName, value)}
        className="block truncate text-left text-accent underline decoration-accent/40"
        title={`FK: ${foreignKey.to_table}.${foreignKey.to_column}`}
        onContextMenu={handleContextMenu}
      >
        {String(value)}
      </button>
    );
  }

  // Object/array
  if (typeof value === "object") {
    return (
      <span className="block truncate text-accent" onContextMenu={handleContextMenu}>
        {JSON.stringify(value)}
      </span>
    );
  }

  // Long text
  const text = String(value);
  if (text.length > 100) {
    return (
      <span onContextMenu={handleContextMenu}>
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "block max-w-[280px] text-left",
            expanded ? "whitespace-pre-wrap" : "truncate",
            isPrimaryKey && "font-semibold text-amber-600",
          )}
          title="Click to expand"
        >
          {expanded ? text : truncateText(text, 100)}
        </button>
      </span>
    );
  }

  // Default
  return (
    <span
      className={cn("block truncate", isPrimaryKey && "font-semibold text-amber-600")}
      onContextMenu={handleContextMenu}
    >
      {text}
    </span>
  );
}

// Detection heuristics

export function isIsoDate(value: string): boolean {
  if (value.length < 10 || value.length > 30) return false;
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value);
}

export function isUnixTimestamp(value: number): boolean {
  // Reasonable range: 2000-01-01 to 2100-01-01
  return value >= 946684800 && value <= 4102444800;
}

export function isJsonString(value: string): boolean {
  if (value.length < 2) return false;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}
