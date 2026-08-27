import type { ReactNode } from "react";
import {
  formatViewCell,
  getViewCell,
  groupViewRows,
  humanizeViewColumn,
  type ViewCell,
  type ViewDisplayRow,
} from "@/features/views/lib/view-presentation";
import type { ViewPresentation, ViewTable } from "@/features/views/types/view.types";
import Badge from "@/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/utils/cn";

interface ViewDataDisplayProps {
  table: ViewTable;
  presentation: ViewPresentation;
}

function getStatusVariant(value: ViewCell): "success" | "warning" | "error" | "muted" {
  const normalized = formatViewCell(value).toLowerCase();
  if (/success|complete|completed|active|merged|closed|passed|ready|yes|true/.test(normalized)) {
    return "success";
  }
  if (/fail|failed|error|cancel|blocked|inactive|no|false/.test(normalized)) return "error";
  if (/pending|queued|waiting|open|progress|running|draft/.test(normalized)) return "warning";
  return "muted";
}

function isStatusColumn(column: string): boolean {
  return /(^|\.)(status|state|conclusion|result|enabled)$/.test(column.toLowerCase());
}

function formatDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ViewValue({
  column,
  value,
  truncate = false,
}: {
  column: string;
  value: ViewCell;
  truncate?: boolean;
}) {
  if (value === null) return <span className="text-subtle-foreground">—</span>;

  if (typeof value === "boolean" || isStatusColumn(column)) {
    return <Badge variant={getStatusVariant(value)}>{formatViewCell(value)}</Badge>;
  }

  const text = formatViewCell(value);
  const date = typeof value === "string" ? formatDate(value) : null;
  return (
    <span
      className={cn(
        "text-foreground",
        typeof value === "number" && "font-mono tabular-nums",
        truncate && "block max-w-90 truncate",
      )}
      title={text}
    >
      {date ?? text}
    </span>
  );
}

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <h2 className="font-sans ui-text-sm text-foreground">{label}</h2>
      <Badge variant="muted" className="tabular-nums">
        {count}
      </Badge>
    </div>
  );
}

function ViewTableDisplay({ table, presentation }: ViewDataDisplayProps) {
  const groups = groupViewRows(table, presentation.groupBy ?? undefined);

  return (
    <div className="h-full overflow-auto p-3">
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.key} className="space-y-2">
            {presentation.groupBy ? (
              <GroupHeader label={group.label} count={group.rows.length} />
            ) : null}
            <div className="overflow-hidden rounded-lg border border-border/70 bg-surface/25">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {table.columns.map((column) => (
                        <TableHead key={column}>{humanizeViewColumn(column)}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.rows.map((row) => (
                      <TableRow key={row.index}>
                        {table.columns.map((column, columnIndex) => (
                          <TableCell
                            key={column}
                            className={cn(
                              column === presentation.titleColumn && "font-medium text-foreground",
                            )}
                          >
                            <ViewValue
                              column={column}
                              value={row.cells[columnIndex] ?? null}
                              truncate
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function getRowMetadata(
  table: ViewTable,
  row: ViewDisplayRow,
  presentation: ViewPresentation,
): Array<{ column: string; value: ViewCell }> {
  const excluded = new Set([
    presentation.titleColumn,
    presentation.descriptionColumn,
    presentation.groupBy,
  ]);
  return table.columns
    .flatMap((column, index) => {
      const value = row.cells[index] ?? null;
      return excluded.has(column) || value === null ? [] : [{ column, value }];
    })
    .slice(0, 4);
}

function ViewItemCard({
  table,
  row,
  presentation,
  compact = false,
}: {
  table: ViewTable;
  row: ViewDisplayRow;
  presentation: ViewPresentation;
  compact?: boolean;
}) {
  const titleCell = getViewCell(table, row.cells, presentation.titleColumn);
  const title = titleCell === null ? `Item ${row.index + 1}` : formatViewCell(titleCell);
  const description = presentation.descriptionColumn
    ? formatViewCell(getViewCell(table, row.cells, presentation.descriptionColumn))
    : null;
  const metadata = getRowMetadata(table, row, presentation);

  return (
    <Card variant="default" className={cn("min-w-0", compact && "gap-2 py-2.5")}>
      <CardHeader className={compact ? "px-2.5" : undefined}>
        <CardTitle className="truncate" title={title}>
          {title}
        </CardTitle>
        {description && description !== "—" ? (
          <CardDescription className="line-clamp-2" title={description}>
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      {metadata.length > 0 ? (
        <CardContent className={cn("flex flex-wrap gap-x-3 gap-y-1.5", compact && "px-2.5")}>
          {metadata.map(({ column, value }) => (
            <div key={column} className="flex min-w-0 items-center gap-1.5 ui-text-sm">
              <span className="text-subtle-foreground">{humanizeViewColumn(column)}</span>
              <ViewValue column={column} value={value} truncate />
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

function ViewListDisplay({ table, presentation }: ViewDataDisplayProps) {
  const groups = groupViewRows(table, presentation.groupBy ?? undefined);

  return (
    <div className="h-full overflow-auto p-3">
      <div className="mx-auto max-w-4xl space-y-6">
        {groups.map((group) => (
          <section key={group.key} className="space-y-2">
            {presentation.groupBy ? (
              <GroupHeader label={group.label} count={group.rows.length} />
            ) : null}
            <div className="grid gap-2">
              {group.rows.map((row) => (
                <ViewItemCard key={row.index} table={table} row={row} presentation={presentation} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ViewBoardDisplay({ table, presentation }: ViewDataDisplayProps) {
  const groups = groupViewRows(table, presentation.groupBy ?? undefined);

  return (
    <div className="flex h-full min-h-0 gap-3 overflow-x-auto p-3">
      {groups.map((group) => (
        <section
          key={group.key}
          className="flex min-w-64 max-w-80 flex-1 flex-col overflow-hidden rounded-lg bg-surface/45"
        >
          <div className="border-border/60 border-b p-2.5">
            <GroupHeader label={group.label} count={group.rows.length} />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {group.rows.map((row) => (
              <ViewItemCard
                key={row.index}
                table={table}
                row={row}
                presentation={presentation}
                compact
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const displays: Record<ViewPresentation["layout"], (props: ViewDataDisplayProps) => ReactNode> = {
  table: ViewTableDisplay,
  list: ViewListDisplay,
  board: ViewBoardDisplay,
};

export function ViewDataDisplay(props: ViewDataDisplayProps) {
  const Display = displays[props.presentation.layout];
  return <>{Display(props)}</>;
}
