import { X } from "lucide-react";
import Dropdown from "@/components/ui/dropdown";
import type { ColumnFilter, ColumnInfo } from "../models/common.types";

interface ColumnFiltersProps {
  columnFilters: ColumnFilter[];
  tableMeta: ColumnInfo[];
  onUpdateFilter: (index: number, updates: Partial<ColumnFilter>) => void;
  onRemoveFilter: (index: number) => void;
  onClearAll: () => void;
}

export default function ColumnFilters({
  columnFilters,
  tableMeta,
  onUpdateFilter,
  onRemoveFilter,
  onClearAll,
}: ColumnFiltersProps) {
  if (columnFilters.length === 0) return null;

  return (
    <div className="border-border border-b bg-secondary-bg px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-text-lighter text-xs">{columnFilters.length} filters</span>
        <button
          onClick={onClearAll}
          className="font-mono text-text-lighter text-xs hover:text-text"
        >
          clear
        </button>
      </div>
      <div className="space-y-1">
        {columnFilters.map((filter, index) => (
          <div key={index} className="flex items-center gap-2 text-xs">
            <Dropdown
              value={filter.column}
              options={tableMeta.map((col) => ({ value: col.name, label: col.name }))}
              onChange={(value) => onUpdateFilter(index, { column: value })}
              size="xs"
              className="min-w-20"
            />

            <Dropdown
              value={filter.operator}
              options={[
                { value: "equals", label: "=" },
                { value: "contains", label: "∋" },
                { value: "startsWith", label: "^" },
                { value: "endsWith", label: "$" },
                { value: "gt", label: ">" },
                { value: "lt", label: "<" },
                { value: "between", label: "⇋" },
              ]}
              onChange={(value) =>
                onUpdateFilter(index, { operator: value as ColumnFilter["operator"] })
              }
              size="xs"
              className="min-w-12"
            />

            <input
              type="text"
              value={filter.value}
              onChange={(e) => onUpdateFilter(index, { value: e.target.value })}
              placeholder="value"
              className="flex-1 border border-border bg-primary-bg px-1 py-0.5 font-mono text-xs"
            />

            {filter.operator === "between" && (
              <input
                type="text"
                value={filter.value2 || ""}
                onChange={(e) => onUpdateFilter(index, { value2: e.target.value })}
                placeholder="value2"
                className="flex-1 border border-border bg-primary-bg px-1 py-0.5 font-mono text-xs"
              />
            )}

            <button
              onClick={() => onRemoveFilter(index)}
              className="text-text-lighter transition-colors hover:text-red-500"
              title="Remove filter"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
