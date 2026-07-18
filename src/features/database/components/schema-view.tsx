import {
  CalendarIcon as Calendar,
  FileTextIcon as FileText,
  FunnelIcon as Filter,
  HashIcon as Hash,
  KeyIcon as Key,
  LinkIcon as Link,
  TextTIcon as Type,
} from "@/ui/icons";
import { Button } from "@/ui/button";
import {
  formatForeignKeyLabel,
  getColumnConstraintLabels,
  mapForeignKeysByColumn,
} from "../lib/database-schema";
import type { ColumnInfo, ForeignKeyInfo } from "../types/common.types";
import { databaseCardClassName } from "./database-surface";

const COLUMN_ICONS: Record<string, { icon: typeof Hash; color: string }> = {
  int: { icon: Hash, color: "text-accent" },
  num: { icon: Hash, color: "text-accent" },
  text: { icon: Type, color: "text-text-lighter" },
  varchar: { icon: Type, color: "text-text-lighter" },
  char: { icon: Type, color: "text-text-lighter" },
  date: { icon: Calendar, color: "text-accent" },
  time: { icon: Calendar, color: "text-accent" },
  blob: { icon: FileText, color: "text-text-lighter" },
  binary: { icon: FileText, color: "text-text-lighter" },
};

function getColumnIcon(type: string, isPrimaryKey: boolean, isForeignKey: boolean) {
  if (isPrimaryKey) return <Key className="text-text-lighter" />;
  if (isForeignKey) return <Link className="text-accent" />;
  const lowerType = type.toLowerCase();
  for (const [key, { icon: Icon, color }] of Object.entries(COLUMN_ICONS)) {
    if (lowerType.includes(key)) return <Icon className={color} />;
  }
  return <Type className="text-text-lighter" />;
}

interface SchemaViewProps {
  tableName: string;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
  onAddFilter: (column: string) => void;
  canFilter?: boolean;
}

export default function SchemaView({
  tableName,
  columns,
  foreignKeys,
  onAddFilter,
  canFilter = true,
}: SchemaViewProps) {
  const fkMap = mapForeignKeysByColumn(foreignKeys);

  return (
    <div className="flex-1 overflow-auto font-sans">
      <div className="px-3 py-3">
        <div className="ui-text-sm text-text">{tableName}</div>
        <div className="ui-text-sm text-text-lighter">{columns.length} columns</div>
      </div>
      <div className={databaseCardClassName("mx-3 mb-3 divide-y divide-border/60")}>
        {columns.map((column) => {
          const fk = fkMap.get(column.name);
          const constraintLabels = getColumnConstraintLabels(column);
          return (
            <div
              key={column.name}
              className="flex items-center justify-between px-3 py-2 transition-colors hover:bg-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {getColumnIcon(column.type, column.primary_key, !!fk)}
                <span className="truncate ui-text-sm text-text">{column.name}</span>
                <span className="ui-text-sm text-text-lighter">{column.type}</span>
                {constraintLabels.map((label) => (
                  <span key={label} className="truncate ui-text-sm text-text-lighter">
                    {label}
                  </span>
                ))}
                {fk && (
                  <span className="truncate ui-text-sm text-accent">
                    {formatForeignKeyLabel(fk)}
                  </span>
                )}
              </div>
              {canFilter && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onAddFilter(column.name)}
                  className="text-text-lighter opacity-60 hover:text-text hover:opacity-100"
                  aria-label={`Filter by ${column.name}`}
                  size="icon"
                >
                  <Filter />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
