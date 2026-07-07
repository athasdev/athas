import {
  ArrowClockwiseIcon as ArrowClockwise,
  ClipboardTextIcon as ClipboardText,
  CodeIcon as Code,
  ColumnsIcon as Columns,
  DatabaseIcon as Database,
  DownloadIcon as Download,
  MinusCircleIcon as MinusCircle,
  PlusCircleIcon as PlusCircle,
  RadioButtonIcon as RadioButton,
  TrashIcon as Trash,
} from "@phosphor-icons/react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { formatQueryResultSummary } from "../lib/query-result-summary";
import type {
  DatabaseInfo,
  DatabaseObjectKind,
  PostgresSubscriptionInfo,
  ViewMode,
} from "../types/common.types";

interface TableToolbarProps {
  fileName: string;
  dbInfo: DatabaseInfo | null;
  selectedObjectKind?: DatabaseObjectKind;
  subscriptionInfo?: PostgresSubscriptionInfo | null;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  isCustomQuery: boolean;
  showColumnTypes: boolean;
  setShowColumnTypes: (show: boolean) => void;
  setIsCustomQuery: (is: boolean) => void;
  hasData: boolean;
  resultRowCount?: number;
  currentPage?: number;
  totalPages?: number;
  exportAsCSV: () => void;
  copyAsJSON: () => void;
  onCreateSubscription?: () => void;
  onToggleSubscription?: () => void;
  onRefreshSubscription?: () => void;
  onDropSubscription?: () => void;
}

const VIEW_TABS: { mode: ViewMode; label: string }[] = [
  { mode: "data", label: "Data" },
  { mode: "schema", label: "Schema" },
  { mode: "info", label: "Info" },
];

export default function TableToolbar({
  fileName,
  dbInfo,
  selectedObjectKind = "table",
  subscriptionInfo,
  viewMode,
  setViewMode,
  isCustomQuery,
  showColumnTypes,
  setShowColumnTypes,
  setIsCustomQuery,
  hasData,
  resultRowCount = 0,
  currentPage,
  totalPages,
  exportAsCSV,
  copyAsJSON,
  onCreateSubscription,
  onToggleSubscription,
  onRefreshSubscription,
  onDropSubscription,
}: TableToolbarProps) {
  const isSubscription = selectedObjectKind === "subscription";
  const resultSummary =
    hasData && viewMode === "data"
      ? formatQueryResultSummary({
          isCustomQuery,
          rowCount: resultRowCount,
          currentPage,
          totalPages,
        })
      : null;
  const exportTooltip = isCustomQuery
    ? "Export visible query page as CSV"
    : "Export visible page as CSV";
  const jsonTooltip = isCustomQuery
    ? "Copy visible query page as JSON"
    : "Copy visible page as JSON";
  const exportLabel = isCustomQuery ? "Export visible query page as CSV" : "Export as CSV";
  const jsonLabel = isCustomQuery ? "Copy visible query page as JSON" : "Copy as JSON";

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <Database className="text-text-lighter" />
            <span className="ui-font ui-text-sm min-w-0 truncate text-text">{fileName}</span>
            {dbInfo && (
              <span className="ui-font ui-text-sm shrink-0 text-text-lighter">
                {dbInfo.tables}t {dbInfo.indexes}i
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border/60 bg-secondary-bg/60 p-0.5">
            {VIEW_TABS.map(({ mode, label }) => (
              <Button
                key={mode}
                onClick={() => setViewMode(mode)}
                variant={viewMode === mode ? "default" : "ghost"}
                compact
                className={cn(
                  "rounded px-2.5 ui-text-sm text-text-lighter",
                  viewMode === mode ? "text-text" : "text-text-lighter",
                )}
                aria-label={`Switch to ${label} view`}
                tooltip={`Switch to ${label} view`}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {viewMode === "data" && !isCustomQuery && !isSubscription && (
            <Button
              onClick={() => setShowColumnTypes(!showColumnTypes)}
              variant="ghost"
              compact
              className="rounded-md px-2 text-text-lighter"
              aria-label="Toggle column types"
              tooltip={showColumnTypes ? "Hide column types" : "Show column types"}
            >
              <Columns />
            </Button>
          )}
          {resultSummary && (
            <span className="px-2 ui-font ui-text-sm text-text-lighter">{resultSummary}</span>
          )}
          {viewMode === "data" && (
            <Button
              onClick={() => setIsCustomQuery(true)}
              variant="ghost"
              compact
              className="rounded-md px-2 text-text-lighter"
              disabled={isCustomQuery}
              aria-label="Open SQL editor"
              tooltip="Open SQL editor"
            >
              <Code />
            </Button>
          )}
          {onCreateSubscription && (
            <Button
              onClick={onCreateSubscription}
              variant="ghost"
              className="rounded-md px-2 text-text-lighter"
              aria-label="Create subscription"
              tooltip="Create subscription"
              compact
            >
              <RadioButton />
            </Button>
          )}
          {isSubscription && subscriptionInfo && onToggleSubscription && (
            <Button
              onClick={onToggleSubscription}
              variant="ghost"
              className="rounded-md px-2 text-text-lighter"
              aria-label={subscriptionInfo.enabled ? "Disable subscription" : "Enable subscription"}
              tooltip={subscriptionInfo.enabled ? "Disable subscription" : "Enable subscription"}
              compact
            >
              {subscriptionInfo.enabled ? <MinusCircle /> : <PlusCircle />}
            </Button>
          )}
          {isSubscription && onRefreshSubscription && (
            <Button
              onClick={onRefreshSubscription}
              variant="ghost"
              className="rounded-md px-2 text-text-lighter"
              aria-label="Refresh subscription"
              tooltip="Refresh subscription"
              compact
            >
              <ArrowClockwise />
            </Button>
          )}
          {isSubscription && onDropSubscription && (
            <Button
              onClick={onDropSubscription}
              variant="ghost"
              className="rounded-md px-2 text-text-lighter"
              aria-label="Drop subscription"
              tooltip="Drop subscription"
              compact
            >
              <Trash />
            </Button>
          )}
          {hasData && (
            <>
              <Button
                onClick={exportAsCSV}
                variant="ghost"
                className="rounded-md px-2 text-text-lighter"
                aria-label={exportLabel}
                tooltip={exportTooltip}
                compact
              >
                <Download weight="fill" />
              </Button>
              <Button
                onClick={copyAsJSON}
                variant="ghost"
                className="rounded-md px-2 text-text-lighter"
                aria-label={jsonLabel}
                tooltip={jsonTooltip}
                compact
              >
                <ClipboardText />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
