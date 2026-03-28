import { Plus, X } from "lucide-react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Select from "@/ui/select";
import type { ColumnFilter, ColumnInfo, FilterOperator } from "../sqlite-types";

const FILTER_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "=" },
  { value: "notEquals", label: "!=" },
  { value: "contains", label: "contains" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "between", label: "between" },
  { value: "isNull", label: "is null" },
  { value: "isNotNull", label: "is not null" },
];

const NO_VALUE_OPERATORS = new Set<FilterOperator>(["isNull", "isNotNull"]);

interface FilterBarProps {
  filters: ColumnFilter[];
  columns: ColumnInfo[];
  onUpdate: (index: number, updates: Partial<ColumnFilter>) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onAddFilter: (column: string) => void;
}

export default function FilterBar({
  filters,
  columns,
  onUpdate,
  onRemove,
  onClear,
  onAddFilter,
}: FilterBarProps) {
  if (filters.length === 0) return null;

  return (
    <div className="mx-3 mb-2 rounded-xl bg-secondary-bg/60 px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-text-lighter text-xs">
            {filters.length} filter{filters.length !== 1 ? "s" : ""}
          </span>
          {columns.length > 0 && (
            <Button
              onClick={() => onAddFilter(columns[0].name)}
              variant="ghost"
              size="xs"
              className="rounded-full gap-0.5 text-text-lighter"
              aria-label="Add filter"
            >
              <Plus />
              Add
            </Button>
          )}
        </div>
        <Button
          onClick={onClear}
          variant="ghost"
          size="xs"
          className="rounded-full text-text-lighter"
          aria-label="Clear all filters"
        >
          Clear all
        </Button>
      </div>
      <div className="space-y-1">
        {filters.map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <Select
              value={f.column}
              options={columns.map((c) => ({ value: c.name, label: c.name }))}
              onChange={(v) => onUpdate(i, { column: v })}
              size="xs"
              className="min-w-20"
            />
            <Select
              value={f.operator}
              options={FILTER_OPERATORS.map((op) => ({ value: op.value, label: op.label }))}
              onChange={(v) => onUpdate(i, { operator: v as FilterOperator })}
              size="xs"
              className="min-w-20"
            />
            {!NO_VALUE_OPERATORS.has(f.operator) && (
              <Input
                value={f.value}
                onChange={(e) => onUpdate(i, { value: e.target.value })}
                placeholder="value"
                size="xs"
                className="flex-1"
              />
            )}
            {f.operator === "between" && (
              <Input
                value={f.value2 || ""}
                onChange={(e) => onUpdate(i, { value2: e.target.value })}
                placeholder="to"
                size="xs"
                className="flex-1"
              />
            )}
            <Button
              onClick={() => onRemove(i)}
              variant="ghost"
              size="icon-xs"
              className="text-text-lighter hover:text-red-500"
              aria-label="Remove filter"
            >
              <X />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
