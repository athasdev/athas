import { Calendar, FileText, Filter, Hash, Key, Link, Type } from "lucide-react";
import { Button } from "@/ui/button";
import type { ColumnInfo, ForeignKeyInfo } from "../sqlite-types";

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
}

export default function SchemaView({
  tableName,
  columns,
  foreignKeys,
  onAddFilter,
}: SchemaViewProps) {
  const fkMap = new Map(foreignKeys.map((fk) => [fk.from_column, fk]));

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-3 py-3">
        <div className="text-sm">{tableName}</div>
        <div className="text-text-lighter text-xs">{columns.length} columns</div>
      </div>
      <div className="mx-3 mb-3 divide-y divide-border/60 rounded-xl bg-secondary-bg/40">
        {columns.map((c) => {
          const fk = fkMap.get(c.name);
          return (
            <div
              key={c.name}
              className="flex items-center justify-between px-3 py-2 transition-colors hover:bg-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {getColumnIcon(c.type, c.primary_key, !!fk)}
                <span className="truncate text-sm">{c.name}</span>
                <span className="text-text-lighter text-xs">{c.type}</span>
                {c.primary_key && <span className="text-text-lighter text-xs">PK</span>}
                {c.notnull && <span className="text-text-lighter text-xs">NN</span>}
                {c.default_value && (
                  <span className="truncate text-text-lighter text-xs">def: {c.default_value}</span>
                )}
                {fk && (
                  <span className="truncate text-accent text-xs">
                    FK {fk.to_table}.{fk.to_column}
                  </span>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onAddFilter(c.name)}
                className="rounded-full text-text-lighter opacity-60 hover:text-text hover:opacity-100"
                aria-label={`Filter by ${c.name}`}
              >
                <Filter />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
