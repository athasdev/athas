import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { cn } from "@/utils/cn";
import type { ForeignKeyInfo } from "../types/common.types";

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
  const handleContextMenu = (e: React.MouseEvent) => {
    onContextMenu?.(e, value, columnName);
  };

  if (value === null || value === undefined) {
    return (
      <Badge variant="muted" onContextMenu={handleContextMenu}>
        NULL
      </Badge>
    );
  }

  // JSON detection
  if (typeof value === "string" && isJsonString(value)) {
    return (
      <ExpandedCellValue
        label={truncateText(value, 50)}
        value={formatJson(value)}
        ariaLabel={`View JSON value in ${columnName}`}
        onContextMenu={handleContextMenu}
      />
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
      <Button
        onClick={() => onFkClick(columnName, value)}
        variant="ghost"
        className="block h-auto truncate p-0 text-left font-normal text-primary underline decoration-accent/40"
        tooltip={`FK: ${foreignKey.to_table}.${foreignKey.to_column}`}
        onContextMenu={handleContextMenu}
      >
        {String(value)}
      </Button>
    );
  }

  // Object/array
  if (typeof value === "object") {
    return (
      <span className="block truncate text-primary" onContextMenu={handleContextMenu}>
        {JSON.stringify(value)}
      </span>
    );
  }

  // Long text
  const text = String(value);
  if (text.length > 100) {
    return (
      <ExpandedCellValue
        label={truncateText(text, 100)}
        value={text}
        ariaLabel={`View full value in ${columnName}`}
        onContextMenu={handleContextMenu}
        primary={isPrimaryKey}
      />
    );
  }

  // Default
  return (
    <span
      className={cn("block truncate font-normal", isPrimaryKey && "text-foreground")}
      onContextMenu={handleContextMenu}
    >
      {text}
    </span>
  );
}

function ExpandedCellValue({
  label,
  value,
  ariaLabel,
  onContextMenu,
  primary = false,
}: {
  label: string;
  value: string;
  ariaLabel: string;
  onContextMenu: (event: React.MouseEvent) => void;
  primary?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "block h-auto max-w-70 truncate p-0 text-left font-normal text-primary",
              primary && "text-foreground",
            )}
            aria-label={ariaLabel}
            onContextMenu={onContextMenu}
          />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-96 max-w-[min(24rem,calc(100vw-16px))]">
        <pre className="overflow-auto whitespace-pre-wrap wrap-break-word font-mono ui-text-sm text-foreground">
          {value}
        </pre>
      </PopoverContent>
    </Popover>
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
