import {
  CalendarIcon,
  FileTextIcon,
  FilterIcon,
  HashIcon,
  KeyIcon,
  LinkIcon,
  TextIcon,
} from "@/ui/icons";
import { Button } from "@/ui/button";
import { ScrollArea } from "@/ui/scroll-area";
import {
  formatForeignKeyLabel,
  getColumnConstraintLabels,
  mapForeignKeysByColumn,
} from "../lib/database-schema";
import type { ColumnInfo, ForeignKeyInfo } from "../types/common.types";
import { databaseCardClassName } from "../utils/database-surface";

const COLUMN_ICONS: Record<string, { icon: typeof HashIcon; color: string }> = {
  int: { icon: HashIcon, color: "text-primary" },
  num: { icon: HashIcon, color: "text-primary" },
  text: { icon: TextIcon, color: "text-subtle-foreground" },
  varchar: { icon: TextIcon, color: "text-subtle-foreground" },
  char: { icon: TextIcon, color: "text-subtle-foreground" },
  date: { icon: CalendarIcon, color: "text-primary" },
  time: { icon: CalendarIcon, color: "text-primary" },
  blob: { icon: FileTextIcon, color: "text-subtle-foreground" },
  binary: { icon: FileTextIcon, color: "text-subtle-foreground" },
};

function getColumnIcon(type: string, isPrimaryKey: boolean, isForeignKey: boolean) {
  if (isPrimaryKey) return <KeyIcon className="text-subtle-foreground" />;
  if (isForeignKey) return <LinkIcon className="text-primary" />;
  const lowerType = type.toLowerCase();
  for (const [key, { icon: Icon, color }] of Object.entries(COLUMN_ICONS)) {
    if (lowerType.includes(key)) return <Icon className={color} />;
  }
  return <TextIcon className="text-subtle-foreground" />;
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
    <ScrollArea className="flex-1 font-sans" orientation="both">
      <div className="px-3 py-3">
        <div className="ui-text-sm text-foreground">{tableName}</div>
        <div className="ui-text-sm text-subtle-foreground">{columns.length} columns</div>
      </div>
      <div className={databaseCardClassName("mx-3 mb-3 divide-y divide-border/60")}>
        {columns.map((column) => {
          const fk = fkMap.get(column.name);
          const constraintLabels = getColumnConstraintLabels(column);
          return (
            <div
              key={column.name}
              className="flex items-center justify-between px-3 py-2 transition-colors hover:bg-accent"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {getColumnIcon(column.type, column.primary_key, !!fk)}
                <span className="truncate ui-text-sm text-foreground">{column.name}</span>
                <span className="ui-text-sm text-subtle-foreground">{column.type}</span>
                {constraintLabels.map((label) => (
                  <span key={label} className="truncate ui-text-sm text-subtle-foreground">
                    {label}
                  </span>
                ))}
                {fk && (
                  <span className="truncate ui-text-sm text-primary">
                    {formatForeignKeyLabel(fk)}
                  </span>
                )}
              </div>
              {canFilter && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onAddFilter(column.name)}
                  className="text-subtle-foreground opacity-60 hover:text-foreground hover:opacity-100"
                  aria-label={`Filter by ${column.name}`}
                  iconOnly
                >
                  <FilterIcon />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
