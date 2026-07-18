import { PlusIcon as Plus, XIcon as X } from "@/ui/icons";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { databaseCardClassName } from "./database-surface";
import type { ColumnFilter, ColumnInfo, FilterOperator } from "../types/common.types";

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

interface ColumnFiltersProps {
  filters: ColumnFilter[];
  columns: ColumnInfo[];
  onUpdate: (index: number, updates: Partial<ColumnFilter>) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onAddFilter: (column: string) => void;
}

export default function ColumnFilters({
  filters,
  columns,
  onUpdate,
  onRemove,
  onClear,
  onAddFilter,
}: ColumnFiltersProps) {
  if (filters.length === 0) return null;

  return (
    <div className={databaseCardClassName("mx-3 mb-2 bg-secondary-bg/60 px-3 py-2")}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-sans ui-text-sm text-text-lighter">
            {filters.length} filter{filters.length !== 1 ? "s" : ""}
          </span>
          {columns.length > 0 && (
            <Button
              onClick={() => onAddFilter(columns[0].name)}
              variant="ghost"
              size="xs"
              className="gap-0.5 text-text-lighter"
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
          className="text-text-lighter"
          aria-label="Clear all filters"
          size="xs"
        >
          Clear all
        </Button>
      </div>
      <div className="space-y-1">
        {filters.map((filter, index) => (
          <div key={index} className="flex items-center gap-2 font-sans ui-text-sm">
            <Select
              value={filter.column}
              options={columns.map((column) => ({ value: column.name, label: column.name }))}
              onChange={(value) => onUpdate(index, { column: value })}
              size="xs"
              className="min-w-20"
            />
            <Select
              value={filter.operator}
              options={FILTER_OPERATORS.map((operator) => ({
                value: operator.value,
                label: operator.label,
              }))}
              onChange={(value) => onUpdate(index, { operator: value as FilterOperator })}
              size="xs"
              className="min-w-20"
            />
            {!NO_VALUE_OPERATORS.has(filter.operator) && (
              <Input
                value={filter.value}
                onChange={(e) => onUpdate(index, { value: e.target.value })}
                placeholder="value"
                size="xs"
                className="flex-1"
              />
            )}
            {filter.operator === "between" && (
              <Input
                value={filter.value2 || ""}
                onChange={(e) => onUpdate(index, { value2: e.target.value })}
                placeholder="to"
                size="xs"
                className="flex-1"
              />
            )}
            <Button
              onClick={() => onRemove(index)}
              variant="ghost"
              size="icon-xs"
              className="text-text-lighter hover:text-error"
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
