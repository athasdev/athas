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
} from "@/ui/icons";
import { PathBreadcrumb } from "@/features/editor/components/toolbar/path-breadcrumb";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import { Button } from "@/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { databaseChipClassName } from "./database-surface";
import { formatQueryResultSummary } from "../lib/query-result-summary";
import type {
  DatabaseInfo,
  DatabaseObjectKind,
  PostgresSubscriptionInfo,
  ViewMode,
} from "../types/common.types";

interface TableToolbarProps {
  fileName: string;
  selectedObjectName?: string | null;
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
  selectedObjectName,
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
    <PaneContentHeader
      context={
        <PathBreadcrumb
          segments={[fileName, ...(selectedObjectName ? [selectedObjectName] : [])]}
          icons={[<Database key="database" />]}
          ariaLabel="Database object"
        />
      }
      detail={dbInfo ? `${dbInfo.tables} tables · ${dbInfo.indexes} indexes` : undefined}
      actions={
        <>
          <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
            <TabsList variant="bare">
              {VIEW_TABS.map(({ mode, label }) => (
                <TabsTrigger key={mode} value={mode} aria-label={`Switch to ${label} view`}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {viewMode === "data" && !isCustomQuery && !isSubscription && (
            <Button
              onClick={() => setShowColumnTypes(!showColumnTypes)}
              variant="ghost"
              iconOnly
              className="text-subtle-foreground"
              aria-label="Toggle column types"
              tooltip={showColumnTypes ? "Hide column types" : "Show column types"}
            >
              <Columns />
            </Button>
          )}
          {resultSummary && (
            <span
              className={databaseChipClassName("px-2 font-sans ui-text-sm text-subtle-foreground")}
            >
              {resultSummary}
            </span>
          )}
          {viewMode === "data" && (
            <Button
              onClick={() => setIsCustomQuery(true)}
              variant="ghost"
              iconOnly
              className="text-subtle-foreground"
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
              className="text-subtle-foreground"
              aria-label="Create subscription"
              tooltip="Create subscription"
              iconOnly
            >
              <RadioButton />
            </Button>
          )}
          {isSubscription && subscriptionInfo && onToggleSubscription && (
            <Button
              onClick={onToggleSubscription}
              variant="ghost"
              className="text-subtle-foreground"
              aria-label={subscriptionInfo.enabled ? "Disable subscription" : "Enable subscription"}
              tooltip={subscriptionInfo.enabled ? "Disable subscription" : "Enable subscription"}
              iconOnly
            >
              {subscriptionInfo.enabled ? <MinusCircle /> : <PlusCircle />}
            </Button>
          )}
          {isSubscription && onRefreshSubscription && (
            <Button
              onClick={onRefreshSubscription}
              variant="ghost"
              className="text-subtle-foreground"
              aria-label="Refresh subscription"
              tooltip="Refresh subscription"
              iconOnly
            >
              <ArrowClockwise />
            </Button>
          )}
          {isSubscription && onDropSubscription && (
            <Button
              onClick={onDropSubscription}
              variant="ghost"
              className="text-subtle-foreground"
              aria-label="Drop subscription"
              tooltip="Drop subscription"
              iconOnly
            >
              <Trash />
            </Button>
          )}
          {hasData && (
            <>
              <Button
                onClick={exportAsCSV}
                variant="ghost"
                className="text-subtle-foreground"
                aria-label={exportLabel}
                tooltip={exportTooltip}
                iconOnly
              >
                <Download weight="fill" />
              </Button>
              <Button
                onClick={copyAsJSON}
                variant="ghost"
                className="text-subtle-foreground"
                aria-label={jsonLabel}
                tooltip={jsonTooltip}
                iconOnly
              >
                <ClipboardText />
              </Button>
            </>
          )}
        </>
      }
    />
  );
}
